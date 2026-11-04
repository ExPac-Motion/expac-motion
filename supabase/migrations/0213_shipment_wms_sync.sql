-- ============================================================
-- 0213  Shipments <-> Motion WMS in sync, both ways
-- ============================================================
-- "Shipments, warehouse, receipts and releases should all sync", with as
-- little manual capture as possible (user, 2026-11-04).
--
--   1. Hubs: each Motion WMS warehouse can match shipments by origin
--      (overseas hubs: China, Hong Kong, US, UK, India, Europe) or by
--      destination (ZA import hubs: Johannesburg, Durban, Cape Town,
--      Port Elizabeth). wms_warehouses.match_codes holds ISO countries
--      ("CN") and / or UN/LOCODEs ("ZADUR"); a LOCODE match beats a
--      country match. A shipment gets its hubs automatically from its
--      origin / destination (job_hubs, auto = true); ops can add, change
--      or remove hubs on the shipment's Hubs card.
--   2. Shipment -> WMS (status driven; a status that jumps past a step
--      counts as reaching it):
--        origin hub       receipt at Collected / Received, release at Departed
--        destination hub  receipt at Arrived / Unloaded,   release at On-Delivery / Delivered
--        transit hub      by hand (Received / Released buttons)
--      Receipt = customer, shipment ref, PO, the quote's packing list
--      (pieces, kg, CBM, packages). Release = everything still on hand,
--      outbound ref = MBL / AWB.
--   3. WMS -> shipment (never backwards, never loops):
--        receipt booked by hand for a shipment -> origin: Received,
--                                                destination: Unloaded
--        release that empties the hub         -> origin: Departed,
--                                                destination: On-Delivery
--        consolidation departed               -> every house shipment: Departed
--   4. Repeats do nothing (one receipt / release per shipment hub; a receipt
--      booked by hand at the same warehouse is adopted). Rolled back: an
--      automatic receipt / release nobody has touched (no moves, check,
--      consol, billing or POD) is undone; anything touched stays and the
--      sync check flags it.
--   5. Sync check: wms_hub_sync (one row per shipment hub) and
--      wms_jobs_without_hub (active shipments past Collected with no hub).
--
-- No WMS emails for automatic receipts (shipment milestone mails go out).
-- Run in the Supabase SQL editor after 0212. Self-contained & idempotent.

-- ---------- 1. Hub matching on the warehouse ----------
alter table public.wms_warehouses
  add column if not exists match_codes text[] not null default '{}',
  add column if not exists match_side text not null default 'origin';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wms_warehouses_match_side_chk') then
    alter table public.wms_warehouses
      add constraint wms_warehouses_match_side_chk check (match_side in ('origin', 'destination'));
  end if;
end;
$$;

-- The Shenzhen DDP warehouse becomes the China hub (user, 2026-11-04); its
-- receipts follow it (they point at the warehouse id, not the code).
update public.wms_warehouses
   set code = 'CN', name = 'China Warehouse Hub'
 where upper(code) = 'CN-DDP'
   and not exists (select 1 from public.wms_warehouses where upper(code) = 'CN');

-- ExPac's hubs today (user, 2026-11-04). Added only when no warehouse with
-- that code or a similar name exists; match codes only filled where blank.
do $$
declare
  hub record;
  wid uuid;
begin
  for hub in select * from (values
    ('CN',  'China Warehouse Hub',          'origin',      array['CN'],               '%china%'),
    ('HK',  'Hong Kong Warehouse Hub',      'origin',      array['HK'],               '%hong kong%'),
    ('US',  'United States Warehouse Hub',  'origin',      array['US'],               '%united states%'),
    ('UK',  'United Kingdom Warehouse Hub', 'origin',      array['GB'],               '%united kingdom%'),
    ('IN',  'India Warehouse Hub',          'origin',      array['IN'],               '%india%'),
    ('EU',  'Europe Warehouse Hub',         'origin',
      array['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT',
            'LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','CH','NO'],                  '%europe%'),
    ('JNB', 'Johannesburg Warehouse Hub',   'destination', array['ZA','ZAJNB'],       '%johannesburg%'),
    ('DUR', 'Durban Warehouse Hub',         'destination', array['ZADUR'],            '%durban%'),
    ('CPT', 'Cape Town Warehouse Hub',      'destination', array['ZACPT'],            '%cape town%'),
    ('PLZ', 'Port Elizabeth Warehouse Hub', 'destination', array['ZAPLZ'],            '%port elizabeth%')
  ) as t(code, name, side, codes, pattern)
  loop
    select id into wid from public.wms_warehouses
     where upper(code) = hub.code or name ilike hub.pattern
     order by (upper(code) = hub.code) desc
     limit 1;
    if wid is null then
      insert into public.wms_warehouses (code, name, match_side, match_codes)
      values (hub.code, hub.name, hub.side, hub.codes);
    else
      update public.wms_warehouses
         set match_codes = hub.codes, match_side = hub.side
       where id = wid and match_codes = '{}';
    end if;
  end loop;
end;
$$;

-- ---------- 2. Hubs per shipment ----------
create table if not exists public.job_hubs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  warehouse_id uuid not null references public.wms_warehouses (id),
  role text not null default 'origin' check (role in ('origin', 'transit', 'destination')),
  position int not null default 0,
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  unique (job_id, warehouse_id)
);
create index if not exists job_hubs_job on public.job_hubs (job_id, position);

alter table public.job_hubs enable row level security;
drop policy if exists "staff full access" on public.job_hubs;
create policy "staff full access" on public.job_hubs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.wms_receipts
  add column if not exists job_hub_id uuid references public.job_hubs (id) on delete set null,
  add column if not exists auto_created boolean not null default false;
create unique index if not exists wms_receipts_job_hub on public.wms_receipts (job_hub_id)
  where job_hub_id is not null;
alter table public.wms_releases
  add column if not exists job_hub_id uuid references public.job_hubs (id) on delete set null,
  add column if not exists auto_created boolean not null default false;
create index if not exists wms_releases_job_hub on public.wms_releases (job_hub_id);

-- ---------- 3. Status order and what each hub expects ----------
-- Position in the board's status list (types.ts SHIPMENT_STATUSES); 0 = blank.
create or replace function public.shipment_status_rank(p_status text)
returns int language sql immutable set search_path = public as $$
  select coalesce(array_position(array[
    'created', 'booked', 'vessel booked', 'flight booked', 'collected', 'received',
    'loaded', 'departed', 'in transit', 'arrived', 'unloaded', 'customs',
    'detained', 'released', 'on-delivery', 'delivered'
  ], lower(btrim(coalesce(p_status, '')))), 0);
$$;

-- in: the hub should hold the goods by now; out: they should have left.
-- Transit hubs are booked by hand, so they never expect anything.
create or replace function public.job_hub_expect(p_hub uuid, out want_in boolean, out want_out boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  hub_role text;
  rk int;
begin
  select h.role, public.shipment_status_rank(j.shipment_status) into hub_role, rk
    from public.job_hubs h join public.jobs j on j.id = h.job_id
   where h.id = p_hub;
  rk := coalesce(rk, 0);
  if hub_role = 'origin' then
    want_in := rk >= public.shipment_status_rank('Collected');
    want_out := rk >= public.shipment_status_rank('Departed');
  elsif hub_role = 'destination' then
    want_in := rk >= public.shipment_status_rank('Arrived');
    want_out := rk >= public.shipment_status_rank('On-Delivery');
  else
    want_in := false;
    want_out := false;
  end if;
end;
$$;

-- Moves a shipment's status forward only (WMS -> shipment), with the same
-- milestone and history entry as the timeline (0196).
create or replace function public.wms_advance_job_status(p_job uuid, p_status text, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare
  cur text;
begin
  select shipment_status into cur from public.jobs where id = p_job;
  if not found or public.shipment_status_rank(cur) >= public.shipment_status_rank(p_status) then
    return;
  end if;
  update public.jobs
     set shipment_status = p_status,
         milestone = coalesce(public.milestone_for_status(p_status), milestone)
   where id = p_job;
  insert into public.job_events (job_id, milestone, note)
  select p_job, j.milestone, 'Shipment Status set to "' || p_status || '" by Motion WMS (' || p_why || ')'
    from public.jobs j where j.id = p_job;
end;
$$;

-- ---------- 4. Book in / release / undo one shipment hub ----------
create or replace function public.wms_hub_receive(p_hub uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.job_hubs%rowtype;
  j public.jobs%rowtype;
  rid uuid;
  pkgs jsonb;
  pcs int;
  kg numeric;
  cbm numeric;
  goods text;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'No access';
  end if;
  select * into h from public.job_hubs where id = p_hub;
  if not found then
    raise exception 'Shipment hub not found';
  end if;
  select id into rid from public.wms_receipts where job_hub_id = p_hub;
  if rid is not null then
    return rid;
  end if;
  select * into j from public.jobs where id = h.job_id;

  -- Already booked in by hand for this shipment at this warehouse: adopt it.
  select id into rid from public.wms_receipts
   where job_id = h.job_id and warehouse_id = h.warehouse_id and job_hub_id is null
   order by received_at
   limit 1;
  if rid is not null then
    update public.wms_receipts set job_hub_id = p_hub where id = rid;
    return rid;
  end if;

  -- Packages from the quote's packing list (kg and CBM are per carton there).
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', '',
           'description', coalesce(q.commodity, ''),
           'type', 'Carton',
           'qty', p.qty_ctns,
           'length_cm', p.length_cm,
           'width_cm', p.width_cm,
           'height_cm', p.height_cm,
           'actual_kg', p.actual_kg
         ) order by p.position), '[]'::jsonb),
         coalesce(round(sum(p.qty_ctns))::int, 0),
         coalesce(round(sum(p.actual_kg * p.qty_ctns), 2), 0),
         coalesce(round(sum(
           coalesce(p.cbm, p.length_cm * p.width_cm * p.height_cm / 1000000.0) * p.qty_ctns
         ), 3), 0)
    into pkgs, pcs, kg, cbm
    from public.packing_list_items p
    join public.quotes q on q.id = p.quote_id
   where p.quote_id = j.quote_id and p.qty_ctns > 0;
  select commodity into goods from public.quotes where id = j.quote_id;

  insert into public.wms_receipts (
    warehouse_id, client_id, job_id, supplier_id, job_hub_id, auto_created, received_at,
    inbound_ref, customer_reference, description, package_type,
    pieces, gross_kg, volume_cbm, packages, notes
  ) values (
    h.warehouse_id, j.client_id, j.id, j.supplier_id, p_hub, true, now(),
    j.reference, j.po_no, goods, case when pcs > 0 then 'Carton' end,
    greatest(pcs, 0), kg, cbm, pkgs,
    'Booked in automatically from shipment ' || j.reference
      || coalesce(' at status ' || nullif(btrim(j.shipment_status), ''), '')
      || case when pcs = 0 then '. No packing list on the quote: count the goods and enter the pieces.' else '.' end
  ) returning id into rid;
  -- Post the receipt's ledger row now (same row trg_wms_receipt_ledger writes;
  -- inside another trigger that one only fires at the end of the outer
  -- statement, too late for a release in the same pass).
  if pcs > 0 then
    delete from public.wms_stock_moves where receipt_id = rid and kind = 'receipt';
    insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
    values (rid, null, pcs, 'receipt', rid, now());
  end if;
  return rid;
end;
$$;
grant execute on function public.wms_hub_receive(uuid) to authenticated;

create or replace function public.wms_hub_release(p_hub uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.job_hubs%rowtype;
  j public.jobs%rowtype;
  r public.wms_receipts%rowtype;
  rel uuid;
  l record;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'No access';
  end if;
  select * into h from public.job_hubs where id = p_hub;
  if not found then
    raise exception 'Shipment hub not found';
  end if;
  select * into j from public.jobs where id = h.job_id;
  select * into r from public.wms_receipts where id = public.wms_hub_receive(p_hub);

  -- On hand per bay = ledger, less release lines whose ledger row hasn't
  -- been posted yet (same pass, see wms_hub_receive).
  create temp table if not exists wms_hub_avail (location_id uuid, pcs int) on commit drop;
  delete from wms_hub_avail;
  insert into wms_hub_avail
  select loc, sum(q)::int from (
    select location_id as loc, qty as q from public.wms_stock_moves where receipt_id = r.id
    union all
    select rl.location_id, -rl.pieces from public.wms_release_lines rl
     where rl.receipt_id = r.id
       and not exists (select 1 from public.wms_stock_moves m where m.ref_id = rl.id and m.kind = 'release')
  ) x group by loc having sum(q) > 0;

  -- Nothing left on hand (already released by hand, or no pieces): done.
  if not exists (select 1 from wms_hub_avail) then
    return null;
  end if;

  insert into public.wms_releases (
    warehouse_id, client_id, job_id, job_hub_id, auto_created, released_at, outbound_ref, notes
  ) values (
    h.warehouse_id, r.client_id, j.id, p_hub, true, now(), j.awb_mbl,
    'Released automatically from shipment ' || j.reference
      || coalesce(' at status ' || nullif(btrim(j.shipment_status), ''), '') || '.'
  ) returning id into rel;

  for l in select location_id, pcs from wms_hub_avail loop
    insert into public.wms_release_lines (release_id, receipt_id, location_id, pieces, gross_kg, volume_cbm)
    values (
      rel, r.id, l.location_id, l.pcs,
      case when r.pieces > 0 then round(r.gross_kg * l.pcs / r.pieces, 2) else 0 end,
      case when r.pieces > 0 then round(r.volume_cbm * l.pcs / r.pieces, 3) else 0 end
    );
  end loop;
  return rel;
end;
$$;
grant execute on function public.wms_hub_release(uuid) to authenticated;

-- Status rolled back: undo what this hub did automatically, if nobody has
-- touched it since. p_receipt = false undoes only the release.
create or replace function public.wms_hub_undo(p_hub uuid, p_receipt boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.wms_receipts%rowtype;
begin
  -- Automatic releases without a POD.
  delete from public.wms_releases x
   where x.job_hub_id = p_hub and x.auto_created
     and x.pod_signed_by is null and x.pod_delivered_at is null
     and coalesce(x.pod_path, '') = '';
  if not p_receipt then
    return;
  end if;
  select * into r from public.wms_receipts where job_hub_id = p_hub and auto_created;
  if not found then
    return;
  end if;
  if exists (select 1 from public.wms_stock_moves m where m.receipt_id = r.id and m.kind <> 'receipt')
     or r.checked_at is not null
     or exists (select 1 from public.wms_consol_houses c where r.id = any (c.receipt_ids))
     or exists (select 1 from public.wms_billing_runs b where b.lines::text like '%' || r.id::text || '%')
  then
    return; -- touched: keep it, the sync check flags it
  end if;
  delete from public.wms_receipts where id = r.id;
end;
$$;

-- Applies every hub's rule for one shipment. A failure on one hub never
-- blocks the status change; the sync check shows what's missing.
create or replace function public.wms_apply_job_hubs(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  h record;
  e record;
begin
  for h in select id from public.job_hubs where job_id = p_job order by position, created_at loop
    select * into e from public.job_hub_expect(h.id);
    begin
      if e.want_out then
        perform public.wms_hub_release(h.id);
      elsif e.want_in then
        perform public.wms_hub_undo(h.id, false);
        perform public.wms_hub_receive(h.id);
      elsif (select role from public.job_hubs where id = h.id) <> 'transit' then
        perform public.wms_hub_undo(h.id, true);
      end if;
    exception when others then
      raise warning 'WMS sync for shipment hub % failed: %', h.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- ---------- 5. Hubs follow the shipment's origin / destination ----------
-- First 2 letters of a LOCODE-led place ("CNSHA Shanghai") = its country.
create or replace function public.wms_match_hub(p_place text, p_side text)
returns uuid language sql stable security definer set search_path = public as $$
  with code as (
    select upper(substring(btrim(coalesce(p_place, '')) from '^([A-Za-z]{5})\M')) as loc
  )
  select w.id
    from public.wms_warehouses w, code
   where w.active and w.match_side = p_side and code.loc is not null
     and (code.loc = any (w.match_codes) or left(code.loc, 2) = any (w.match_codes))
   order by (code.loc = any (w.match_codes)) desc, w.code
   limit 1;
$$;

create or replace function public.wms_auto_hubs(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  side text;
  want uuid;
begin
  select * into j from public.jobs where id = p_job;
  if not found then
    return;
  end if;
  foreach side in array array['origin', 'destination'] loop
    want := public.wms_match_hub(case side when 'origin' then j.origin else j.destination end, side);
    -- An automatic hub that no longer matches goes, unless it already holds a receipt.
    delete from public.job_hubs h
     where h.job_id = p_job and h.auto and h.role = side
       and h.warehouse_id is distinct from want
       and not exists (select 1 from public.wms_receipts r where r.job_hub_id = h.id);
    -- Add the matching hub unless ops already set a hub for that side.
    if want is not null and not exists (
      select 1 from public.job_hubs h where h.job_id = p_job and (h.role = side or h.warehouse_id = want)
    ) then
      insert into public.job_hubs (job_id, warehouse_id, role, position, auto, created_by)
      values (p_job, want, side, case side when 'origin' then 0 else 100 end, true, null);
    end if;
  end loop;
end;
$$;

create or replace function public.wms_job_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.origin is distinct from old.origin
     or new.destination is distinct from old.destination then
    perform public.wms_auto_hubs(new.id); -- adding a hub applies the status rules (below)
  end if;
  if tg_op = 'INSERT'
     or btrim(coalesce(new.shipment_status, '')) is distinct from btrim(coalesce(old.shipment_status, '')) then
    perform public.wms_apply_job_hubs(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_wms_job_status_sync on public.jobs;
drop trigger if exists trg_wms_job_sync on public.jobs;
create trigger trg_wms_job_sync
  after insert or update of shipment_status, origin, destination on public.jobs
  for each row execute function public.wms_job_sync();

-- A hub added, changed or removed after the shipment has moved on catches up
-- at once. (Removing a hub keeps its receipt; it just loses the link.)
create or replace function public.wms_job_hub_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.wms_apply_job_hubs(old.job_id);
  else
    perform public.wms_apply_job_hubs(new.job_id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_wms_job_hub_changed on public.job_hubs;
create trigger trg_wms_job_hub_changed
  after insert or delete or update of role, warehouse_id on public.job_hubs
  for each row execute function public.wms_job_hub_changed();

-- ---------- 6. WMS -> shipment ----------
-- A receipt booked by hand for a shipment joins that shipment's hubs and
-- moves its status on. (Automatic receipts come from a status change, so
-- they run inside another trigger: pg_trigger_depth() > 1.)
create or replace function public.wms_receipt_to_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
  hub_role text;
begin
  if pg_trigger_depth() > 1 or new.job_id is null or new.auto_created then
    return null;
  end if;
  select id, role into hid, hub_role from public.job_hubs
   where job_id = new.job_id and warehouse_id = new.warehouse_id;
  if hid is null then
    select case
             when not exists (select 1 from public.job_hubs where job_id = new.job_id and role = 'origin') then 'origin'
             else 'transit'
           end into hub_role;
    insert into public.job_hubs (job_id, warehouse_id, role, position, auto)
    values (new.job_id, new.warehouse_id, hub_role, case hub_role when 'origin' then 0 else 50 end, false)
    returning id into hid;
  end if;
  if new.job_hub_id is null
     and not exists (select 1 from public.wms_receipts where job_hub_id = hid) then
    update public.wms_receipts set job_hub_id = hid where id = new.id;
  end if;
  if hub_role = 'origin' then
    perform public.wms_advance_job_status(new.job_id, 'Received', new.receipt_no);
  elsif hub_role = 'destination' then
    perform public.wms_advance_job_status(new.job_id, 'Unloaded', new.receipt_no);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_wms_receipt_to_job on public.wms_receipts;
create trigger trg_wms_receipt_to_job
  after insert or update of job_id on public.wms_receipts
  for each row execute function public.wms_receipt_to_job();

-- A release by hand that empties a shipment hub's receipt moves the shipment on.
create or replace function public.wms_release_to_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.wms_receipts%rowtype;
  hub_role text;
  rel_no text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  select * into r from public.wms_receipts where id = new.receipt_id;
  if r.job_hub_id is null or r.job_id is null then
    return null;
  end if;
  if coalesce((select sum(qty) from public.wms_stock_moves where receipt_id = r.id), 0) > 0 then
    return null; -- part release: still in the hub
  end if;
  select role into hub_role from public.job_hubs where id = r.job_hub_id;
  select release_no into rel_no from public.wms_releases where id = new.release_id;
  if hub_role = 'origin' then
    perform public.wms_advance_job_status(r.job_id, 'Departed', rel_no);
  elsif hub_role = 'destination' then
    perform public.wms_advance_job_status(r.job_id, 'On-Delivery', rel_no);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_wms_release_to_job on public.wms_release_lines;
create trigger trg_wms_release_to_job
  after insert on public.wms_release_lines
  for each row execute function public.wms_release_to_job();

-- A consolidation that departs takes every house shipment to Departed.
create or replace function public.wms_consol_to_jobs()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jid uuid;
begin
  if new.status = 'departed' and old.status is distinct from 'departed' then
    for jid in
      select distinct job_id from public.wms_consol_houses where consol_id = new.id and job_id is not null
      union
      select new.job_id where new.job_id is not null
    loop
      perform public.wms_advance_job_status(jid, 'Departed', new.consol_no);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_wms_consol_to_jobs on public.wms_consols;
create trigger trg_wms_consol_to_jobs
  after update of status on public.wms_consols
  for each row execute function public.wms_consol_to_jobs();

-- ---------- 7. Sync check ----------
create or replace view public.wms_hub_sync
with (security_invoker = true) as
with hubs as (
  select h.*, e.want_in, e.want_out
    from public.job_hubs h
    cross join lateral public.job_hub_expect(h.id) e
),
quote_tot as (
  select p.quote_id,
         round(sum(p.qty_ctns))::int as pieces,
         round(sum(p.actual_kg * p.qty_ctns), 2) as kg
    from public.packing_list_items p
   where p.qty_ctns > 0
   group by p.quote_id
),
rc as (
  select r.*,
         coalesce((select sum(m.qty) from public.wms_stock_moves m where m.receipt_id = r.id), 0)::int as on_hand
    from public.wms_receipts r
   where r.job_hub_id is not null
)
select
  h.id as hub_id,
  h.job_id,
  j.reference as job_ref,
  j.client_id,
  j.shipment_status,
  h.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  h.position,
  h.role,
  h.auto,
  h.want_in,
  h.want_out,
  r.id as receipt_id,
  r.receipt_no,
  r.received_at,
  coalesce(r.pieces, 0) as receipt_pieces,
  coalesce(r.gross_kg, 0) as receipt_kg,
  coalesce(r.on_hand, 0) as on_hand,
  (select max(x.released_at) from public.wms_releases x where x.job_hub_id = h.id) as released_at,
  qt.pieces as quote_pieces,
  qt.kg as quote_kg,
  case
    when r.id is null and (h.want_in or h.want_out) then 'missing_receipt'
    when r.id is not null and h.want_out and r.on_hand > 0 then 'still_in_hub'
    when r.id is not null and h.role <> 'transit' and not h.want_in and not h.want_out then 'ahead_of_status'
    when r.id is not null and coalesce(r.pieces, 0) = 0 then 'no_pieces'
    when r.id is not null and qt.pieces is not null and r.pieces <> qt.pieces then 'pieces_differ'
    when r.id is not null and qt.kg is not null and qt.kg > 0
         and abs(r.gross_kg - qt.kg) > greatest(1, qt.kg * 0.05) then 'kg_differ'
    when r.id is null then 'waiting'
    else 'in_sync'
  end as state
from hubs h
join public.jobs j on j.id = h.job_id
join public.wms_warehouses w on w.id = h.warehouse_id
left join rc r on r.job_hub_id = h.id
left join quote_tot qt on qt.quote_id = j.quote_id;
grant select on public.wms_hub_sync to authenticated;

-- Active shipments past Collected that don't pass through any hub: either
-- they really don't touch a warehouse, or a hub is missing (no match).
create or replace view public.wms_jobs_without_hub
with (security_invoker = true) as
select j.id as job_id, j.reference as job_ref, j.client_id, j.shipment_status, j.origin, j.destination, j.mode
  from public.jobs j
 where j.ops_completed_at is null
   and public.shipment_status_rank(j.shipment_status) >= public.shipment_status_rank('Collected')
   and public.shipment_status_rank(j.shipment_status) < public.shipment_status_rank('Delivered')
   and not exists (select 1 from public.job_hubs h where h.job_id = j.id);
grant select on public.wms_jobs_without_hub to authenticated;

-- ---------- 8. Existing shipments get their hubs (user, 2026-11-04) ----------
-- Active shipments only; their current status then books them in / out
-- where it should (an already-departed shipment is booked in and released).
do $$
declare
  jid uuid;
begin
  for jid in
    select id from public.jobs
     where ops_completed_at is null
       and public.shipment_status_rank(shipment_status) < public.shipment_status_rank('Delivered')
  loop
    perform public.wms_auto_hubs(jid);
    -- Second pass once all its hubs exist (a hub added later in the same
    -- statement can leave an earlier one half done).
    perform public.wms_apply_job_hubs(jid);
  end loop;
end;
$$;

-- ---------- 9. Live updates (as 0212) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_hubs'
  ) then
    alter publication supabase_realtime add table public.job_hubs;
  end if;
end;
$$;
