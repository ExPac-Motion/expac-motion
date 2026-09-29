-- ============================================================
-- 0106  Expand the 4-stage Milestone funnel to 7 stages
-- ============================================================
-- Dashboard's Operational Funnel (jobs.milestone) only ever had Booked / In
-- Transit / Customs / Delivered. Expanding to match the real operational
-- flow: Created, Booked, In Transit, Arrived, Customs, On Delivery,
-- Delivered -- see MILESTONE_BY_STATUS in src/lib/types.ts for how each of
-- the 14 granular Shipment Status values now maps onto these 7.
--
-- Run in the Supabase SQL editor after 0105. Self-contained & idempotent.

alter table public.jobs drop constraint if exists jobs_milestone_check;
alter table public.jobs add constraint jobs_milestone_check
  check (milestone in
    ('Created', 'Booked', 'In Transit', 'Arrived', 'Customs', 'On Delivery', 'Delivered'));
alter table public.jobs alter column milestone set default 'Created';

alter table public.job_events drop constraint if exists job_events_milestone_check;
alter table public.job_events add constraint job_events_milestone_check
  check (milestone in
    ('Created', 'Booked', 'In Transit', 'Arrived', 'Customs', 'On Delivery', 'Delivered'));

-- A new shipment starts life at "Created", not "Booked" -- it hasn't
-- actually been booked with a carrier yet at the moment the quote is won.
create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id    uuid;
  v_client_id uuid;
  v_awb_mbl   text;
  q           public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  v_client_id := q.client_id;
  if v_client_id is null and q.lead_id is not null then
    v_client_id := public.promote_lead_to_customer(q.lead_id);
  end if;

  v_awb_mbl := case
    when q.mode ilike 'air%' or q.mode ilike 'courier%'
      then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
    else coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
  end;

  update public.quotes
     set status = 'accepted',
         client_id = v_client_id,
         accepted_at = coalesce(accepted_at, now()),
         updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, po_no, client_id, supplier_id,
       origin, destination, mode, milestone,
       awb_mbl, container_no, container_type, etd, eta, carrier_name,
       vessel_name, shipping_line, provisional_delivery_date)
    values
      (q.id, q.reference, nullif(trim(q.customer_reference), ''),
       v_client_id, q.supplier_id, q.origin, q.destination, q.mode, 'Created',
       v_awb_mbl, nullif(q.container_no, ''), nullif(q.container_type, ''),
       q.etd, q.eta, nullif(q.carrier_name, ''), nullif(q.vessel_name, ''),
       nullif(q.shipping_line, ''), q.provisional_delivery_date)
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Created', 'Job created from accepted quote');

    insert into public.ops_tasks (kind, title, status, priority, job_id, quote_id, client_id)
    values
      ('task', 'Request commercial invoice', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Book carrier', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Send booking confirmation to customer', 'open', 'normal', v_job_id, q.id, v_client_id);
  end if;

  return v_job_id;
end;
$$;

-- One-off: recompute every existing job's milestone from its current
-- Shipment Status, so the expanded funnel reflects real distribution
-- immediately instead of everything sitting wherever it was hardcoded to at
-- creation time until the next manual status change.
update public.jobs
set milestone = case shipment_status
  when 'Created'     then 'Created'
  when 'Booked'      then 'Booked'
  when 'Collected'   then 'Booked'
  when 'Received'    then 'Booked'
  when 'Loaded'      then 'In Transit'
  when 'Departed'    then 'In Transit'
  when 'In Transit'  then 'In Transit'
  when 'Arrived'     then 'Arrived'
  when 'Unloaded'    then 'Arrived'
  when 'Customs'     then 'Customs'
  when 'Detained'    then 'Customs'
  when 'Released'    then 'Customs'
  when 'On-Delivery' then 'On Delivery'
  when 'Delivered'   then 'Delivered'
  else milestone
end
where shipment_status is not null;
