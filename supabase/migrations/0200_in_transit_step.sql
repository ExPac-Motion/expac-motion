-- ============================================================
-- 0200  Timeline: In Transit step for every mode
-- ============================================================
-- In Transit sits between Departed and Arrived on Sea LCL, Sea FCL,
-- Air / Courier and Road. It was already a Shipment Status (and maps to
-- the In Transit milestone), it just wasn't a timeline step, so shipments
-- on it showed as an "older" status.
--
-- Every shipment's steps are rebuilt: the new step is added in place
-- (done if the shipment is already past it, dated from the status history
-- where it was set), existing steps and dates are kept. Shipments whose
-- status is In Transit get the steps before it ticked, like a board move.
--
-- Run in the Supabase SQL editor after 0199. Self-contained & idempotent.

create or replace function public.job_timeline_template(p_mode text)
returns text[] language sql immutable as $$
  select case
    when p_mode ilike 'Sea Freight (FCL)%' then array[
      'Created', 'Booked', 'Collected', 'Loaded', 'Departed', 'In Transit', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Sea%' then array[
      'Created', 'Booked', 'Collected', 'Received', 'Loaded', 'Departed', 'In Transit', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Road%' then array[
      'Created', 'Booked', 'Collected', 'Departed', 'In Transit', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    else array[
      'Created', 'Booked', 'Collected', 'Received', 'Departed', 'In Transit', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
  end;
$$;

-- Rebuild every shipment's steps (adds In Transit, keeps the rest).
do $$
declare
  r record;
begin
  for r in select id from public.jobs loop
    perform public.job_timeline_seed(r.id);
  end loop;
end;
$$;

-- A shipment already on In Transit: the steps before it done, after it not.
update public.job_timeline_steps s
   set done = true
  from public.jobs j, public.job_timeline_steps t
 where j.id = s.job_id and t.job_id = j.id and t.step = 'In Transit'
   and btrim(coalesce(j.shipment_status, '')) = 'In Transit'
   and s.sort_order <= t.sort_order and not s.done and not s.skipped and s.step <> 'Detained';

notify pgrst, 'reload schema';
