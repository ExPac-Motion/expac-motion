-- ============================================================
-- 0235  Live tracking ETA always reaches the shipment
-- ============================================================
-- Only the ShipsGo webhook copied the tracked ETD / ETA onto the quote and
-- shipment. A refresh from Motion (Live Tracking / the shipment page)
-- updated job_tracking but left the shipment on the old date, so the board
-- showed e.g. 18/11 while tracking said 19/11.
--
--   1. Trigger on job_tracking: whenever a ShipsGo row's ETD / ETA changes,
--      however it was written, the quote and shipment get the same dates.
--      (Both are updated here: the quote <-> shipment sync triggers only act
--      on direct edits, 0198.)
--   2. jobs_eta_change (0234) marks those changes as "tracking".
--   3. One-off: active shipments whose ETA differs from ShipsGo's are
--      corrected now.
--
-- Run in the Supabase SQL editor after 0234. Self-contained & idempotent.

-- 2. A change made by this trigger counts as tracking, even when a signed-in
--    user pressed Refresh.
create or replace function public.jobs_eta_change()
returns trigger
language plpgsql
as $$
begin
  if new.eta is distinct from old.eta then
    new.eta_prev := old.eta;
    new.eta_changed_at := now();
    new.eta_changed_source := case
      when auth.uid() is null or current_setting('expac.eta_source', true) = 'tracking' then 'tracking'
      else 'manual' end;
  end if;
  return new;
end;
$$;

-- 1.
create or replace function public.tracking_dates_to_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote uuid;
begin
  if coalesce(new.provider, '') <> 'shipsgo' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.eta is not distinct from old.eta
     and new.etd is not distinct from old.etd then
    return new;
  end if;
  if new.eta is null and new.etd is null then
    return new;
  end if;

  perform set_config('expac.eta_source', 'tracking', true);
  select quote_id into v_quote from public.jobs where id = new.job_id;

  if v_quote is not null then
    update public.quotes
       set eta = coalesce(new.eta, eta),
           etd = coalesce(new.etd, etd)
     where id = v_quote
       and (eta is distinct from coalesce(new.eta, eta) or etd is distinct from coalesce(new.etd, etd));
  end if;
  update public.jobs
     set eta = coalesce(new.eta, eta),
         etd = coalesce(new.etd, etd)
   where id = new.job_id
     and (eta is distinct from coalesce(new.eta, eta) or etd is distinct from coalesce(new.etd, etd));

  perform set_config('expac.eta_source', '', true);
  return new;
end;
$$;

drop trigger if exists job_tracking_dates_to_shipment on public.job_tracking;
create trigger job_tracking_dates_to_shipment
  after insert or update of eta, etd on public.job_tracking
  for each row execute function public.tracking_dates_to_shipment();

-- 3. Correct the active shipments that drifted. Via the quote where there
--    is one (its sync trigger, 0198, carries the date to the shipment).
select set_config('expac.eta_source', 'tracking', false);
update public.quotes qu
   set eta = t.eta
  from public.jobs j
  join public.job_tracking t on t.job_id = j.id
 where qu.id = j.quote_id
   and t.provider = 'shipsgo'
   and t.eta is not null
   and j.eta is distinct from t.eta
   and coalesce(j.shipment_status, '') not in ('Delivered', 'Completed');
update public.jobs j
   set eta = t.eta
  from public.job_tracking t
 where t.job_id = j.id
   and t.provider = 'shipsgo'
   and t.eta is not null
   and j.eta is distinct from t.eta
   and coalesce(j.shipment_status, '') not in ('Delivered', 'Completed');
select set_config('expac.eta_source', '', false);
