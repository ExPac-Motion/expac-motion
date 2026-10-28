-- ============================================================
-- 0201  Timeline: Vessel Booked (sea) / Flight Booked (air, courier)
-- ============================================================
-- A step between Booked and Collected: Vessel Booked on Sea LCL / FCL,
-- Flight Booked on Air / Air Consol / Courier. Road is unchanged. Both
-- are Shipment Statuses in the Booked milestone.
--
-- Every shipment's steps are rebuilt: the new step is added in place
-- (ticked if the shipment is already past it), existing steps and dates
-- are kept.
--
-- Run in the Supabase SQL editor after 0200. Self-contained & idempotent.

create or replace function public.job_timeline_template(p_mode text)
returns text[] language sql immutable as $$
  select case
    when p_mode ilike 'Sea Freight (FCL)%' then array[
      'Created', 'Booked', 'Vessel Booked', 'Collected', 'Loaded', 'Departed', 'In Transit', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Sea%' then array[
      'Created', 'Booked', 'Vessel Booked', 'Collected', 'Received', 'Loaded', 'Departed', 'In Transit', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Road%' then array[
      'Created', 'Booked', 'Collected', 'Departed', 'In Transit', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    else array[
      'Created', 'Booked', 'Flight Booked', 'Collected', 'Received', 'Departed', 'In Transit', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
  end;
$$;

-- Same mapping as MILESTONE_BY_STATUS in the app.
create or replace function public.milestone_for_status(p text)
returns text language sql immutable as $$
  select case btrim(coalesce(p, ''))
    when 'Created' then 'Created'
    when 'Booked' then 'Booked'
    when 'Vessel Booked' then 'Booked'
    when 'Flight Booked' then 'Booked'
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

-- Rebuild every shipment's steps (adds the new step, keeps the rest).
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
