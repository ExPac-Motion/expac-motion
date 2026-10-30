-- ============================================================
-- 0206  Shipment progress follows the tracking
-- ============================================================
-- ShipsGo's confirmed events (tracking_events, is_actual) never reached the
-- shipment timeline, so /track and the portal showed "Vessel departed:
-- Expected ..." on a ship ShipsGo had seen sail. Now:
--
--   LOAD                         -> Loaded            (first)
--   DEPA / DEP                   -> Departed + In Transit (first)
--   ARRV / ARR at the POD        -> Arrived
--   DISC at the POD              -> Unloaded
--
-- "At the POD" = the event's port is the shipment's port of discharge, so
-- an arrival at a transshipment port doesn't count. A step already done
-- keeps its date; a step the mode doesn't have is skipped. Status and
-- milestone follow (job_timeline_sync), with one history line per step.
--
-- timeline_from_tracking(job) runs on every ShipsGo webhook and Refresh,
-- and once here for every active shipment. Vessel tracking (AIS, 0204)
-- marks In Transit with Departed too, through the same step marker.
--
-- Run in the Supabase SQL editor after 0205. Self-contained & idempotent.

-- One step done with its actual date (not over a step already done with a
-- date, not a skipped one), with a history line naming the source.
create or replace function public.tracking_mark_step(p_job uuid, p_step text, p_at timestamptz, p_source text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  s public.job_timeline_steps%rowtype;
  d date := (p_at at time zone 'Africa/Johannesburg')::date;
begin
  select * into s from public.job_timeline_steps where job_id = p_job and step = p_step;
  if not found or s.skipped or (s.done and s.actual_date is not null) then
    return false;
  end if;
  update public.job_timeline_steps
     set done = true, actual_date = d, updated_at = now()
   where id = s.id;
  insert into public.job_events (job_id, milestone, note)
  select p_job, j.milestone, format('%s: %s %s', p_source, p_step, to_char(d, 'DD Mon YYYY'))
    from public.jobs j where j.id = p_job;
  return true;
end;
$$;
revoke execute on function public.tracking_mark_step(uuid, text, timestamptz, text) from public, anon, authenticated;

-- AIS (0204): Departed also starts In Transit; same marker, then sync.
create or replace function public.ais_mark_step(p_job uuid, p_step text, p_at timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  changed boolean;
begin
  changed := public.tracking_mark_step(p_job, p_step, p_at, 'Vessel tracking (AIS)');
  if p_step = 'Departed' then
    changed := public.tracking_mark_step(p_job, 'In Transit', p_at, 'Vessel tracking (AIS)') or changed;
  end if;
  if not changed then
    return null;
  end if;
  return public.job_timeline_sync(p_job);
end;
$$;
revoke execute on function public.ais_mark_step(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.ais_mark_step(uuid, text, timestamptz) to service_role;

-- ShipsGo events -> timeline steps for one shipment.
create or replace function public.timeline_from_tracking(p_job uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  pod text;
  at_ timestamptz;
  changed boolean := false;
  src constant text := 'Tracking (ShipsGo)';
begin
  if auth.role() <> 'service_role' and not public.is_staff() then
    raise exception 'Only ExPac staff can do this';
  end if;
  -- Port of discharge: ShipsGo's, else the shipment's destination code.
  select upper(coalesce(nullif(trim(t.pod), ''), split_part(coalesce(j.destination, ''), ',', 1)))
    into pod
    from public.jobs j
    left join public.job_tracking t on t.job_id = j.id
   where j.id = p_job;
  pod := regexp_replace(coalesce(pod, ''), '[^A-Z0-9]', '', 'g');

  select min(occurred_at) into at_ from public.tracking_events
   where job_id = p_job and is_actual and upper(event_code) = 'LOAD' and occurred_at is not null;
  if at_ is not null then
    changed := public.tracking_mark_step(p_job, 'Loaded', at_, src) or changed;
  end if;

  select min(occurred_at) into at_ from public.tracking_events
   where job_id = p_job and is_actual and upper(event_code) in ('DEPA', 'DEP') and occurred_at is not null;
  if at_ is not null then
    changed := public.tracking_mark_step(p_job, 'Departed', at_, src) or changed;
    changed := public.tracking_mark_step(p_job, 'In Transit', at_, src) or changed;
  end if;

  if pod <> '' then
    select min(occurred_at) into at_ from public.tracking_events
     where job_id = p_job and is_actual and upper(event_code) in ('ARRV', 'ARR') and occurred_at is not null
       and regexp_replace(upper(coalesce(locode, '')), '[^A-Z0-9]', '', 'g') in (pod, right(pod, 3));
    if at_ is not null then
      changed := public.tracking_mark_step(p_job, 'Arrived', at_, src) or changed;
    end if;

    select min(occurred_at) into at_ from public.tracking_events
     where job_id = p_job and is_actual and upper(event_code) = 'DISC' and occurred_at is not null
       and regexp_replace(upper(coalesce(locode, '')), '[^A-Z0-9]', '', 'g') in (pod, right(pod, 3));
    if at_ is not null then
      changed := public.tracking_mark_step(p_job, 'Unloaded', at_, src) or changed;
    end if;
  end if;

  if not changed then
    return null;
  end if;
  return public.job_timeline_sync(p_job);
end;
$$;
revoke execute on function public.timeline_from_tracking(uuid) from public, anon;
grant execute on function public.timeline_from_tracking(uuid) to authenticated, service_role;

-- Once now for every active shipment with tracking events.
do $$
declare
  r record;
begin
  for r in
    select distinct e.job_id
      from public.tracking_events e
      join public.jobs j on j.id = e.job_id
     where j.ops_completed_at is null
  loop
    perform public.timeline_from_tracking(r.job_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
