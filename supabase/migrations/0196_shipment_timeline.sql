-- ============================================================
-- 0196  Shipment timeline: steps per mode, planned + actual dates
-- ============================================================
-- Every shipment gets the steps for its mode (Sea LCL, Sea FCL, Air /
-- Courier, Road), each with a planned and an actual date. The last step
-- marked done IS the shipment's status: job_timeline_sync writes
-- jobs.shipment_status + milestone + a job_events row, the same three
-- things the Active Shipments board does, so the board, funnel, counts,
-- customer emails and portal keep working unchanged.
--
-- Kept in sync both ways:
--   * board status dropdown -> that step done (today if no date), the
--     steps before it done, the ones after it not done;
--   * ETD / ETA / PDD <-> planned date of Departed / Arrived / Delivered;
--   * POD delivered date -> actual date of Delivered;
--   * mode change -> step list rebuilt, dates kept for shared steps.
--
-- Step names are the existing Shipment Status values, so the status ->
-- milestone mapping is unchanged. Detained is optional: only "done" when
-- it happens.
--
-- Run in the Supabase SQL editor after 0195. Self-contained & idempotent.
-- Adds one table and backfills it from job_status_history; no existing
-- data changes. Undo: drop table public.job_timeline_steps cascade.

-- ---------- 1. Table ----------
create table if not exists public.job_timeline_steps (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete cascade,
  step             text not null,
  sort_order         int not null,
  done             boolean not null default false,
  planned_date     date,
  actual_date      date,
  note             text,
  skipped          boolean not null default false,
  customer_visible boolean not null default true,
  updated_by       uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at       timestamptz not null default now(),
  unique (job_id, step)
);
create index if not exists job_timeline_steps_job_idx on public.job_timeline_steps (job_id, sort_order);

alter table public.job_timeline_steps enable row level security;
drop policy if exists "team full access" on public.job_timeline_steps;
create policy "team full access" on public.job_timeline_steps
  for all to authenticated using (public.can_see_accounts()) with check (public.can_see_accounts());

-- ---------- 2. Step lists + status -> milestone ----------
create or replace function public.job_timeline_template(p_mode text)
returns text[] language sql immutable as $$
  select case
    when p_mode ilike 'Sea Freight (FCL)%' then array[
      'Created', 'Booked', 'Collected', 'Loaded', 'Departed', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Sea%' then array[
      'Created', 'Booked', 'Collected', 'Received', 'Loaded', 'Departed', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Road%' then array[
      'Created', 'Booked', 'Collected', 'Departed', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    else array[
      'Created', 'Booked', 'Collected', 'Received', 'Departed', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
  end;
$$;

-- Same mapping as MILESTONE_BY_STATUS in the app.
create or replace function public.milestone_for_status(p text)
returns text language sql immutable as $$
  select case btrim(coalesce(p, ''))
    when 'Created' then 'Created'
    when 'Booked' then 'Booked'
    when 'Collected' then 'Booked'
    when 'Received' then 'Booked'
    when 'Loaded' then 'In Transit'
    when 'Departed' then 'In Transit'
    when 'In Transit' then 'In Transit'
    when 'Arrived' then 'Arrived'
    when 'Unloaded' then 'Arrived'
    when 'Customs' then 'Customs'
    when 'Detained' then 'Customs'
    when 'Released' then 'Customs'
    when 'On-Delivery' then 'On Delivery'
    when 'Delivered' then 'Delivered'
  end;
$$;

-- ---------- 3. Seed / rebuild a shipment's steps ----------
create or replace function public.job_timeline_seed(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  steps text[];
  st text;
  cur int;
  i int;
begin
  select * into j from public.jobs where id = p_job;
  if not found then
    return;
  end if;
  steps := public.job_timeline_template(j.mode);
  st := btrim(coalesce(j.shipment_status, ''));
  delete from public.job_timeline_steps where job_id = p_job and not (step = any (steps));

  cur := coalesce(array_position(steps, st), 0);
  if cur = 0 and (j.milestone = 'Delivered' or j.pod_delivered_at is not null) then
    cur := array_length(steps, 1);
  end if;
  if cur = 0 then
    cur := 1;
  end if;

  for i in 1 .. array_length(steps, 1) loop
    insert into public.job_timeline_steps (job_id, step, sort_order, done, planned_date, actual_date, updated_by)
    values (
      p_job, steps[i], i,
      case
        when steps[i] = 'Detained' then st = 'Detained'
          or exists (select 1 from public.job_status_history h where h.job_id = p_job and h.status = 'Detained')
        else i <= cur
      end,
      case steps[i]
        when 'Departed' then j.etd
        when 'Arrived' then j.eta
        when 'Delivered' then j.provisional_delivery_date
      end,
      case
        when steps[i] = 'Created' then (j.created_at at time zone 'Africa/Johannesburg')::date
        when steps[i] = 'Delivered' and j.pod_delivered_at is not null then j.pod_delivered_at
        else (select (min(h.changed_at) at time zone 'Africa/Johannesburg')::date
                from public.job_status_history h
               where h.job_id = p_job and h.status = steps[i])
      end,
      null
    )
    on conflict (job_id, step) do update set sort_order = excluded.sort_order;
  end loop;
end;
$$;
revoke execute on function public.job_timeline_seed(uuid) from public, anon;
grant execute on function public.job_timeline_seed(uuid) to authenticated;

-- ---------- 4. Keep steps in step with the shipment ----------
create or replace function public.job_timeline_on_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  st text;
  pos int;
  today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if tg_op = 'INSERT' or new.mode is distinct from old.mode then
    perform public.job_timeline_seed(new.id);
    return null;
  end if;

  if new.etd is distinct from old.etd then
    update public.job_timeline_steps set planned_date = new.etd where job_id = new.id and step = 'Departed';
  end if;
  if new.eta is distinct from old.eta then
    update public.job_timeline_steps set planned_date = new.eta where job_id = new.id and step = 'Arrived';
  end if;
  if new.provisional_delivery_date is distinct from old.provisional_delivery_date then
    update public.job_timeline_steps set planned_date = new.provisional_delivery_date
     where job_id = new.id and step = 'Delivered';
  end if;
  if new.pod_delivered_at is not null and new.pod_delivered_at is distinct from old.pod_delivered_at then
    update public.job_timeline_steps set actual_date = new.pod_delivered_at
     where job_id = new.id and step = 'Delivered';
  end if;

  -- Status set on the board (or by job_timeline_sync): that step is done,
  -- the ones before it too, the ones after it not.
  st := btrim(coalesce(new.shipment_status, ''));
  if st <> '' and st is distinct from btrim(coalesce(old.shipment_status, '')) then
    select sort_order into pos from public.job_timeline_steps where job_id = new.id and step = st;
    if pos is not null then
      update public.job_timeline_steps
         set done = true, actual_date = coalesce(actual_date, today), updated_at = now()
       where job_id = new.id and step = st and not done;
      update public.job_timeline_steps
         set done = true, updated_at = now()
       where job_id = new.id and sort_order < pos and not done and not skipped and step <> 'Detained';
      update public.job_timeline_steps
         set done = false, updated_at = now()
       where job_id = new.id and sort_order > pos and done;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_job_timeline on public.jobs;
create trigger trg_job_timeline
  after insert or update of mode, shipment_status, etd, eta, provisional_delivery_date, pod_delivered_at
  on public.jobs
  for each row execute function public.job_timeline_on_job();

-- ---------- 5. Status follows the last done step ----------
create or replace function public.job_timeline_sync(p_job uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare
  st text;
  cur text;
  ms text;
begin
  select step into st from public.job_timeline_steps
   where job_id = p_job and done and not skipped
   order by sort_order desc limit 1;
  st := coalesce(st, 'Created');
  select shipment_status into cur from public.jobs where id = p_job;
  if st is distinct from btrim(coalesce(cur, '')) then
    ms := public.milestone_for_status(st);
    update public.jobs set shipment_status = st, milestone = coalesce(ms, milestone) where id = p_job;
    insert into public.job_events (job_id, milestone, note)
    select p_job, j.milestone, 'Shipment Status set to "' || st || '"' from public.jobs j where j.id = p_job;
  end if;
  return st;
end;
$$;
revoke execute on function public.job_timeline_sync(uuid) from public, anon;
grant execute on function public.job_timeline_sync(uuid) to authenticated;

-- ---------- 6. Move to next step ----------
create or replace function public.job_timeline_advance(p_job uuid, p_date date default null, p_note text default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  s public.job_timeline_steps%rowtype;
begin
  if not public.can_see_accounts() then
    raise exception 'Only ExPac staff can move a shipment';
  end if;
  if not exists (select 1 from public.job_timeline_steps where job_id = p_job) then
    perform public.job_timeline_seed(p_job);
  end if;
  select * into s from public.job_timeline_steps
   where job_id = p_job and not done and not skipped and step <> 'Detained'
     and sort_order > coalesce((select max(sort_order) from public.job_timeline_steps
                               where job_id = p_job and done and not skipped), 0)
   order by sort_order limit 1;
  if not found then
    raise exception 'This shipment is already at its last step';
  end if;
  update public.job_timeline_steps
     set done = true,
         actual_date = coalesce(p_date, (now() at time zone 'Africa/Johannesburg')::date),
         note = coalesce(nullif(btrim(p_note), ''), note),
         updated_by = auth.uid(), updated_at = now()
   where id = s.id;
  return public.job_timeline_sync(p_job);
end;
$$;
revoke execute on function public.job_timeline_advance(uuid, date, text) from public, anon;
grant execute on function public.job_timeline_advance(uuid, date, text) to authenticated;

-- ---------- 7. Edit one step ----------
-- p: any of planned_date, actual_date, note, customer_visible, skipped, done.
-- Date, skip and done changes are logged to the shipment's history.
create or replace function public.job_timeline_set(p_step uuid, p jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare
  s public.job_timeline_steps%rowtype;
  changes text[] := '{}';
  d date;
  b boolean;
  today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if not public.can_see_accounts() then
    raise exception 'Only ExPac staff can edit a shipment timeline';
  end if;
  select * into s from public.job_timeline_steps where id = p_step;
  if not found then
    raise exception 'Step not found';
  end if;

  if p ? 'planned_date' then
    d := nullif(p ->> 'planned_date', '')::date;
    if d is distinct from s.planned_date then
      changes := changes || format('%s planned %s → %s', s.step,
        coalesce(to_char(s.planned_date, 'DD Mon YYYY'), '—'), coalesce(to_char(d, 'DD Mon YYYY'), '—'));
      update public.job_timeline_steps set planned_date = d where id = s.id;
      if s.step = 'Departed' then
        update public.jobs set etd = d where id = s.job_id;
      elsif s.step = 'Arrived' then
        update public.jobs set eta = d where id = s.job_id;
      elsif s.step = 'Delivered' then
        update public.jobs set provisional_delivery_date = d where id = s.job_id;
      end if;
    end if;
  end if;

  if p ? 'actual_date' then
    d := nullif(p ->> 'actual_date', '')::date;
    if d is distinct from s.actual_date then
      changes := changes || format('%s date %s → %s', s.step,
        coalesce(to_char(s.actual_date, 'DD Mon YYYY'), '—'), coalesce(to_char(d, 'DD Mon YYYY'), '—'));
      update public.job_timeline_steps set actual_date = d where id = s.id;
    end if;
  end if;

  if p ? 'note' then
    update public.job_timeline_steps set note = nullif(btrim(p ->> 'note'), '') where id = s.id;
  end if;

  if p ? 'customer_visible' then
    update public.job_timeline_steps set customer_visible = coalesce((p ->> 'customer_visible')::boolean, true)
     where id = s.id;
  end if;

  if p ? 'skipped' then
    b := coalesce((p ->> 'skipped')::boolean, false);
    if b is distinct from s.skipped then
      changes := changes || format('%s %s', s.step, case when b then 'skipped' else 'no longer skipped' end);
      update public.job_timeline_steps set skipped = b, done = case when b then false else done end where id = s.id;
    end if;
  end if;

  if p ? 'done' then
    b := coalesce((p ->> 'done')::boolean, false);
    if b is distinct from s.done then
      if b then
        changes := changes || format('%s done', s.step);
        update public.job_timeline_steps
           set done = true, skipped = false, actual_date = coalesce(actual_date, today)
         where id = s.id;
      else
        changes := changes || format('%s undone', s.step);
        update public.job_timeline_steps set done = false, actual_date = null where id = s.id;
      end if;
    end if;
  end if;

  update public.job_timeline_steps set updated_by = auth.uid(), updated_at = now() where id = s.id;

  if array_length(changes, 1) > 0 then
    insert into public.job_events (job_id, milestone, note)
    select s.job_id, j.milestone, 'Timeline: ' || array_to_string(changes, '; ')
      from public.jobs j where j.id = s.job_id;
  end if;

  return public.job_timeline_sync(s.job_id);
end;
$$;
revoke execute on function public.job_timeline_set(uuid, jsonb) from public, anon;
grant execute on function public.job_timeline_set(uuid, jsonb) to authenticated;

-- ---------- 8. Portal: the customer's own shipments ----------
-- Customer-visible steps only; actual date once done; planned only where
-- the customer already sees it (ETD / ETA / PDD).
create or replace view public.client_job_timeline
with (security_barrier = true) as
select s.id, s.job_id, s.step, s.sort_order, s.done,
       case when s.done then s.actual_date end as actual_date,
       case when s.step in ('Departed', 'Arrived', 'Delivered') then s.planned_date end as planned_date
from public.job_timeline_steps s
join public.jobs j on j.id = s.job_id
where j.client_id = public.my_client_id()
  and s.customer_visible
  and not s.skipped;
revoke all on public.client_job_timeline from anon;
grant select on public.client_job_timeline to authenticated;

-- ---------- 9. Backfill every existing shipment ----------
do $$
declare
  r record;
begin
  for r in select id from public.jobs loop
    perform public.job_timeline_seed(r.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
