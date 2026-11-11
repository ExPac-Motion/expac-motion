-- ============================================================
-- 0239  Transshipment: sailing legs per shipment
-- ============================================================
-- A shipment can sail on more than one vessel (e.g. Ningbo -> Singapore on
-- CARL SCHULTE, Singapore -> Durban on SUNNY PHOENIX). ShipsGo already sends
-- every leg's vessel / voyage / port / date on its events; until now the
-- shipment kept only the first vessel.
--
--   1. job_tracking.legs: the legs the tracking webhook works out
--      (src/lib/legs.ts): vessel, voyage, IMO, POL / ETD, POD / ETA, each date
--      actual or estimated. job_tracking.vessel_* follows the leg that has
--      the cargo now, so the live map switches ship at the transshipment
--      port; the shipment's Vessel / Voyage is the vessel arriving in SA.
--   2. jobs.manual_legs: legs typed in on the shipment, for shipments live
--      tracking doesn't follow. Tracked legs win when both exist.
--   3. Customer Portal: legs on client_job_tracking, manual legs and the
--      seal number (0238) on client_jobs (columns appended at the end).
--
-- Run in the Supabase SQL editor after 0238. Self-contained & idempotent.

alter table public.job_tracking add column if not exists legs jsonb;
alter table public.jobs add column if not exists manual_legs jsonb not null default '[]'::jsonb;

create or replace view public.client_job_tracking
with (security_barrier = true) as
select t.job_id, t.status, t.carrier, t.pol, t.pod, t.etd, t.eta,
       t.pod_eta, t.pod_ata, t.last_event, t.vessel_name, t.voyage,
       t.pol_lat, t.pol_lon, t.pod_lat, t.pod_lon,
       t.vessel_lat, t.vessel_lon, t.position_at, t.synced_at,
       t.route_path,
       t.provider, t.atd, t.ais_lat, t.ais_lon, t.ais_at,
       t.legs
from public.job_tracking t
join public.jobs j on j.id = t.job_id
where j.client_id = public.my_client_id();
grant select on public.client_job_tracking to authenticated;

create or replace view public.client_jobs
with (security_barrier = true) as
select j.id, j.reference, j.client_id, j.mode, j.milestone, j.shipment_status,
       j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name,
       j.carrier_name, j.provisional_delivery_date, j.etd, j.eta,
       j.origin, j.destination, j.created_at,
       s.company as supplier_company,
       j.po_no,
       j.pod_signed_by, j.pod_delivered_at,
       j.quote_id,
       j.shipment_kind, j.master_job_id, j.house_no, j.clearance_basis,
       j.seal_no, j.manual_legs
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_jobs to authenticated;

notify pgrst, 'reload schema';
