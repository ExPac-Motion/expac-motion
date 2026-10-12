-- ============================================================
-- 0159  Portal shipment page: quotation link + milestone timeline
-- ============================================================
-- * client_jobs gains quote_id, so the portal's shipment page can show the
--   quotation it came from (cargo, incoterms, value, quoted total).
-- * client_job_events: when each milestone was reached (stage + time only,
--   ExPac's notes stay internal), for the progress bar.
--
-- Run in the Supabase SQL editor after 0158. Self-contained & idempotent.

create or replace view public.client_jobs
with (security_barrier = true) as
select j.id, j.reference, j.client_id, j.mode, j.milestone, j.shipment_status,
       j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name,
       j.carrier_name, j.provisional_delivery_date, j.etd, j.eta,
       j.origin, j.destination, j.created_at,
       s.company as supplier_company,
       j.po_no,
       j.pod_signed_by, j.pod_delivered_at,
       j.quote_id
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_jobs to authenticated;

create or replace view public.client_job_events
with (security_barrier = true) as
select e.id, e.job_id, e.milestone, e.created_at
from public.job_events e
join public.jobs j on j.id = e.job_id
where j.client_id = public.my_client_id();
grant select on public.client_job_events to authenticated;

notify pgrst, 'reload schema';
