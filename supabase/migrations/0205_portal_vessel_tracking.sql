-- ============================================================
-- 0205  Every sea shipment tracked by default: ShipsGo + live vessel
-- ============================================================
-- Builds on 0204 (vessel tracking on AIS):
--
--   1. Live vessel position for ShipsGo shipments too. AIS writes its own
--      columns (ais_lat / ais_lon / ais_at), so ShipsGo's status, dates
--      and map ends are never overwritten; maps show the live fix.
--   2. vessels + airlines: the Settings › Operations lists. Motion
--      remembers each ship's MMSI (with its IMO) once it's entered on a
--      shipment or in Settings, and fill_vessel_mmsi() puts it on every
--      other shipment on that ship (same IMO from ShipsGo, or the same
--      name). Run by /api/vessel-sync each time.
--   3. Customer portal (client_job_tracking) and public /track
--      (track_shipment): provider, ATD, vessel ETA / ATA and the live
--      position, so customers see the real ship, not a port-to-port line.
--      Nothing internal (no MMSI, no IMO).
--   4. pg_cron: /api/tracking-register every 10 minutes registers sea
--      shipments with ShipsGo as soon as a container / BL is saved (1
--      credit each, as a manual Refresh), no Refresh needed.
--
-- Run in the Supabase SQL editor after 0204. Self-contained & idempotent.

-- ---------- 1. Live position columns ----------
alter table public.job_tracking
  add column if not exists ais_lat double precision,
  add column if not exists ais_lon double precision,
  add column if not exists ais_at  timestamptz;

-- ---------- 2. Vessels and airlines (Settings › Operations) ----------
-- The operations reference lists. A vessel may be listed before its MMSI
-- is known; the MMSI is unique once given.
create table if not exists public.vessels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  mmsi          text unique check (mmsi is null or mmsi ~ '^[0-9]{9}$'),
  imo           text,
  shipping_line text,
  notes         text,
  updated_at    timestamptz not null default now()
);
create index if not exists vessels_imo_idx on public.vessels (imo);
create index if not exists vessels_name_idx on public.vessels (upper(name));
alter table public.vessels enable row level security;
drop policy if exists "staff full access" on public.vessels;
create policy "staff full access" on public.vessels
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.airlines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  iata       text,            -- 2-letter airline code, e.g. EK
  awb_prefix text,            -- 3-digit AWB prefix, e.g. 176
  notes      text,
  updated_at timestamptz not null default now()
);
create unique index if not exists airlines_name_key on public.airlines (upper(name));
alter table public.airlines enable row level security;
drop policy if exists "staff full access" on public.airlines;
create policy "staff full access" on public.airlines
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- An MMSI saved on a shipment is remembered, with the IMO ShipsGo / AIS
-- found for that shipment and the vessel name: onto the vessel of that
-- MMSI, else the listed vessel of that name still without one, else new.
create or replace function public.remember_vessel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_imo  text;
  v_name text := nullif(trim(new.vessel_name), '');
  v_id   uuid;
begin
  if new.vessel_mmsi is null or new.vessel_mmsi !~ '^[0-9]{9}$' then
    return null;
  end if;
  select nullif(nullif(trim(vessel_imo), ''), '0') into v_imo from public.job_tracking where job_id = new.id;
  select id into v_id from public.vessels where mmsi = new.vessel_mmsi;
  if v_id is null and v_name is not null then
    select id into v_id from public.vessels where mmsi is null and upper(name) = upper(v_name) limit 1;
  end if;
  if v_id is null then
    insert into public.vessels (name, mmsi, imo) values (coalesce(v_name, 'MMSI ' || new.vessel_mmsi), new.vessel_mmsi, v_imo);
  else
    update public.vessels
       set mmsi = new.vessel_mmsi, imo = coalesce(imo, v_imo), updated_at = now()
     where id = v_id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_remember_vessel on public.jobs;
create trigger trg_remember_vessel
  after insert or update of vessel_mmsi on public.jobs
  for each row execute function public.remember_vessel();

insert into public.vessels (name, mmsi, imo)
select distinct on (j.vessel_mmsi) coalesce(nullif(trim(j.vessel_name), ''), 'MMSI ' || j.vessel_mmsi),
       j.vessel_mmsi, nullif(nullif(trim(t.vessel_imo), ''), '0')
  from public.jobs j
  left join public.job_tracking t on t.job_id = j.id
 where j.vessel_mmsi ~ '^[0-9]{9}$'
on conflict (mmsi) do nothing;

-- Active sea shipments without an MMSI get the one of a known vessel:
-- by the IMO ShipsGo / AIS reported, else by a vessel name only one known
-- ship carries. Returns how many were filled.
create or replace function public.fill_vessel_mmsi()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  -- The vessel sync (service role) or staff saving a vessel in Settings.
  if auth.role() <> 'service_role' and not public.is_staff() then
    raise exception 'Only ExPac staff can do this';
  end if;
  with known_names as (
    select upper(trim(name)) as name, min(mmsi) as mmsi
      from public.vessels
     where nullif(trim(name), '') is not null and mmsi is not null
     group by upper(trim(name))
    having count(*) = 1
  ),
  pick as (
    select j.id,
           coalesce(
             (select v.mmsi from public.vessels v
               where v.imo is not null and v.mmsi is not null and v.imo = nullif(nullif(trim(t.vessel_imo), ''), '0')
               order by v.updated_at desc limit 1),
             -- by name only when no IMO is known for the shipment (a known
             -- IMO that matches no vessel is a different ship)
             (select k.mmsi from known_names k
               where k.name = upper(trim(j.vessel_name))
                 and nullif(nullif(trim(t.vessel_imo), ''), '0') is null)
           ) as mmsi
      from public.jobs j
      left join public.job_tracking t on t.job_id = j.id
     where j.vessel_mmsi is null
       and j.mode ilike 'Sea%'
       and j.ops_completed_at is null
  )
  update public.jobs j set vessel_mmsi = p.mmsi
    from pick p
   where p.id = j.id and p.mmsi is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.fill_vessel_mmsi() from public, anon;
grant execute on function public.fill_vessel_mmsi() to authenticated, service_role;

-- ---------- 3. Customer portal + public /track ----------
create or replace view public.client_job_tracking
with (security_barrier = true) as
select t.job_id, t.status, t.carrier, t.pol, t.pod, t.etd, t.eta,
       t.pod_eta, t.pod_ata, t.last_event, t.vessel_name, t.voyage,
       t.pol_lat, t.pol_lon, t.pod_lat, t.pod_lon,
       t.vessel_lat, t.vessel_lon, t.position_at, t.synced_at,
       t.route_path,
       t.provider, t.atd, t.ais_lat, t.ais_lon, t.ais_at
from public.job_tracking t
join public.jobs j on j.id = t.job_id
where j.client_id = public.my_client_id();

create or replace function public.track_shipment(p_reference text, p_key text default null)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with pack as (
    select
      p.quote_id,
      sum(p.qty_ctns) as qty,
      sum(p.actual_kg * p.qty_ctns) as total_actual_kg,
      sum(coalesce(p.cbm, (p.length_cm * p.width_cm * p.height_cm) / 1000000.0) * p.qty_ctns) as total_cbm
    from public.packing_list_items p
    group by p.quote_id
  ),
  j as (
    select j.*,
      -- The shipment's own key, or its quotation's (quote emails link before
      -- the shipment exists).
      coalesce(nullif(trim(p_key), ''), '') <> ''
        and (trim(p_key) = j.track_key
             or exists (select 1 from public.quotes q where q.id = j.quote_id and q.track_key = trim(p_key)))
        as full_view
    from public.jobs j
    where upper(j.reference) = upper(trim(p_reference))
    limit 1
  )
  select jsonb_build_object(
    'reference', j.reference,
    'mode', j.mode,
    'full_view', j.full_view,
    'customer', case when j.full_view then c.company end,
    'status', coalesce(t.status, j.shipment_status, j.milestone),
    'carrier', coalesce(t.carrier, j.carrier_name),
    'vessel_name', coalesce(t.vessel_name, j.vessel_name),
    'voyage', t.voyage,
    'pol', coalesce(t.pol, j.origin),
    'pod', coalesce(t.pod, j.destination),
    'pol_lat', t.pol_lat, 'pol_lon', t.pol_lon,
    'pod_lat', t.pod_lat, 'pod_lon', t.pod_lon,
    'vessel_lat', t.vessel_lat, 'vessel_lon', t.vessel_lon,
    'position_at', t.position_at,
    'route_path', t.route_path,
    'provider', t.provider,
    'atd', t.atd,
    'pod_eta', t.pod_eta,
    'pod_ata', t.pod_ata,
    'ais_lat', t.ais_lat, 'ais_lon', t.ais_lon, 'ais_at', t.ais_at,
    'etd', coalesce(t.etd::text, j.etd::text),
    'eta', coalesce(t.pod_eta::date::text, t.eta::text, j.eta::text),
    'last_event', t.last_event,
    'shipper', case when j.full_view then s.company end,
    'customer_ref', case when j.full_view then j.po_no end,
    'pdd', j.provisional_delivery_date::text,
    'qty', pk.qty,
    'cw_kg', case when pk.quote_id is null then null else greatest(
      coalesce(pk.total_actual_kg, 0),
      coalesce(pk.total_cbm, 0) * case when j.mode = 'Sea Freight (LCL)' then 1000 else 167 end
    ) end,
    'ttl_vol', pk.total_cbm,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_code', e.event_code,
        'description', e.description,
        'location', e.location,
        'locode', e.locode,
        'lat', e.lat, 'lon', e.lon,
        'vessel_name', e.vessel_name,
        'voyage', e.voyage,
        'occurred_at', e.occurred_at,
        'is_actual', e.is_actual
      ) order by e.occurred_at)
      from public.tracking_events e
      where e.job_id = j.id
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'step', st.step,
        'done', st.done,
        'actual_date', case when st.done then st.actual_date::text end,
        'planned_date', case when st.step in ('Departed', 'Arrived', 'Delivered') then st.planned_date::text end
      ) order by st.sort_order)
      from public.job_timeline_steps st
      where st.job_id = j.id and st.customer_visible and not st.skipped
    ), '[]'::jsonb)
  )
  from j
  left join public.job_tracking t on t.job_id = j.id
  left join public.clients c on c.id = j.client_id
  left join public.suppliers s on s.id = j.supplier_id
  left join pack pk on pk.quote_id = j.quote_id;
$$;

revoke execute on function public.track_shipment(text, text) from public;
grant execute on function public.track_shipment(text, text) to anon, authenticated;


-- ---------- 4. ShipsGo registration every 10 minutes ----------
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, ShipsGo registration stays on Refresh';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'tracking-register') then
    perform cron.unschedule('tracking-register');
  end if;
  perform cron.schedule(
    'tracking-register',
    '5-59/10 * * * *',
    $cron$
      select net.http_post(
        url := c.site_url || '/api/tracking-register',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      from private.follow_up_config c
      where c.site_url is not null and c.cron_secret is not null
      limit 1;
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
