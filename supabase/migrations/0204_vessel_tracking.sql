-- ============================================================
-- 0204  Vessel tracking (AIS) for sea shipments without a container / BL
-- ============================================================
-- Some agents (DDP) may not share the container number or the B/L / Sea
-- Waybill, so ShipsGo has nothing to track. Instead we follow the ship
-- itself on the free aisstream.io AIS feed, by its MMSI number:
--
--   1. jobs.vessel_mmsi  — the ship's 9-digit MMSI (found once per vessel
--      on VesselFinder / MarineTraffic). jobs.voyage_no — the carrier's
--      voyage, shown with the vessel (AIS has no voyage); kept in step with
--      the quotation's voyage_no both ways, like 0198's fields.
--   2. job_tracking      — AIS state on the same row ShipsGo uses
--      (provider = 'ais'): MMSI, ATD, last time seen at the port of loading,
--      the ship's own next port + ETA, speed and navigation status.
--   3. ais_mark_step()   — the AIS sync marks Departed (ATD) / Arrived (ATA)
--      on the timeline. Service role only; a step already done by hand
--      keeps its date.
--   4. pg_cron           — /api/vessel-sync every 10 minutes.
--
-- Run in the Supabase SQL editor after 0203. Self-contained & idempotent.

-- ---------- 1. Shipment fields ----------
alter table public.jobs
  add column if not exists vessel_mmsi text,
  add column if not exists voyage_no   text;

update public.jobs j
   set voyage_no = nullif(trim(q.voyage_no), '')
  from public.quotes q
 where q.id = j.quote_id
   and j.voyage_no is null
   and nullif(trim(q.voyage_no), '') is not null;

-- Voyage: quote -> shipment
create or replace function public.sync_quote_voyage_to_job()
returns trigger language plpgsql security invoker as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.jobs set voyage_no = nullif(trim(new.voyage_no), '') where quote_id = new.id;
  return null;
end;
$$;
drop trigger if exists trg_quote_voyage_sync on public.quotes;
create trigger trg_quote_voyage_sync
  after update of voyage_no on public.quotes
  for each row
  when (new.voyage_no is distinct from old.voyage_no)
  execute function public.sync_quote_voyage_to_job();

-- Voyage: shipment -> quote
create or replace function public.sync_job_voyage_to_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quote_id is null or pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.quotes set voyage_no = coalesce(new.voyage_no, '') where id = new.quote_id;
  return null;
end;
$$;
drop trigger if exists trg_job_voyage_sync on public.jobs;
create trigger trg_job_voyage_sync
  after update of voyage_no on public.jobs
  for each row
  when (new.voyage_no is distinct from old.voyage_no)
  execute function public.sync_job_voyage_to_quote();

-- ---------- 2. AIS state on job_tracking ----------
alter table public.job_tracking
  add column if not exists vessel_mmsi   text,
  add column if not exists atd           timestamptz,      -- actual departure, port of loading
  add column if not exists pol_seen_at   timestamptz,      -- last AIS fix at the port of loading
  add column if not exists next_port     text,             -- the ship's own AIS destination
  add column if not exists next_port_eta timestamptz,      -- ... and its ETA there
  add column if not exists static_at     timestamptz,      -- when that destination / ETA was received
  add column if not exists speed_kn      double precision,
  add column if not exists nav_status    text;

-- ---------- 3. Timeline: Departed / Arrived from AIS ----------
create or replace function public.ais_mark_step(p_job uuid, p_step text, p_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  s public.job_timeline_steps%rowtype;
  d date := (p_at at time zone 'Africa/Johannesburg')::date;
begin
  select * into s from public.job_timeline_steps where job_id = p_job and step = p_step;
  if not found or s.skipped or (s.done and s.actual_date is not null) then
    return null;
  end if;
  update public.job_timeline_steps
     set done = true, actual_date = d, updated_at = now()
   where id = s.id;
  insert into public.job_events (job_id, milestone, note)
  select p_job, j.milestone, format('Vessel tracking (AIS): %s %s', p_step, to_char(d, 'DD Mon YYYY'))
    from public.jobs j where j.id = p_job;
  return public.job_timeline_sync(p_job);
end;
$$;
revoke execute on function public.ais_mark_step(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ais_mark_step(uuid, text, timestamptz) to service_role;

-- ---------- 4. Every 10 minutes ----------
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, vessels are checked only on "Check now"';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'vessel-sync') then
    perform cron.unschedule('vessel-sync');
  end if;
  perform cron.schedule(
    'vessel-sync',
    '*/10 * * * *',
    $cron$
      select net.http_post(
        url := c.site_url || '/api/vessel-sync',
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
