-- ============================================================
-- 0236  Shipment status / timeline step: Clearance Started
-- ============================================================
-- A new step between In Transit and Arrived on every mode (customs
-- clearance lodged before the goods land). It sits in the In Transit
-- milestone so the Operational Funnel never steps backwards.
--
-- Updates: job_timeline_template, milestone_for_status,
-- shipment_status_rank (WMS hub sync) and customs_eligible, then rebuilds
-- every shipment's steps (the new step is added in place, ticked if the
-- shipment is already past it; existing steps and dates are kept).
--
-- Run in the Supabase SQL editor after 0235. Self-contained & idempotent.

create or replace function public.job_timeline_template(p_mode text)
returns text[] language sql immutable as $$
  select case
    when p_mode ilike 'Sea Freight (FCL)%' then array[
      'Created', 'Booked', 'Vessel Booked', 'Collected', 'Loaded', 'Departed', 'In Transit', 'Clearance Started', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Sea%' then array[
      'Created', 'Booked', 'Vessel Booked', 'Collected', 'Received', 'Loaded', 'Departed', 'In Transit', 'Clearance Started', 'Arrived', 'Unloaded',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    when p_mode ilike 'Road%' then array[
      'Created', 'Booked', 'Collected', 'Departed', 'In Transit', 'Clearance Started', 'Arrived',
      'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered']
    else array[
      'Created', 'Booked', 'Flight Booked', 'Collected', 'Received', 'Departed', 'In Transit', 'Clearance Started', 'Arrived',
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
    when 'Clearance Started' then 'In Transit'
    when 'Arrived' then 'Arrived'
    when 'Unloaded' then 'Arrived'
    when 'Customs' then 'Customs'
    when 'Detained' then 'Customs'
    when 'Released' then 'Customs'
    when 'On-Delivery' then 'On Delivery'
    when 'Delivered' then 'Delivered'
  end;
$$;

-- Position in the board's status list (types.ts SHIPMENT_STATUSES); 0 = blank.
create or replace function public.shipment_status_rank(p_status text)
returns int language sql immutable set search_path = public as $$
  select coalesce(array_position(array[
    'created', 'booked', 'vessel booked', 'flight booked', 'collected', 'received',
    'loaded', 'departed', 'in transit', 'clearance started', 'arrived', 'unloaded', 'customs',
    'detained', 'released', 'on-delivery', 'delivered'
  ], lower(btrim(coalesce(p_status, '')))), 0);
$$;

-- As 0230, plus Clearance Started.
create or replace function public.customs_eligible(j public.jobs)
returns boolean language sql stable security definer set search_path = public as $$
  select (j.mode like 'Air%' or j.mode like 'Sea%')
     and btrim(coalesce(j.shipment_status, '')) in ('In Transit', 'Clearance Started', 'Arrived', 'Unloaded', 'Customs', 'Detained')
     and j.ops_completed_at is null
     and not (coalesce(j.shipment_kind, 'direct') = 'master' and j.clearance_basis = 'house')
     and not (coalesce(j.shipment_kind, 'direct') = 'house' and exists (
       select 1 from public.jobs m where m.id = j.master_job_id and m.clearance_basis = 'master'));
$$;

-- Rebuild every shipment's steps (adds Clearance Started, keeps the rest).
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
