-- 0151: proof of delivery.
--   * Shipments: the signed POD is a shipment document of type
--     "Proof of Delivery" (shared with the customer); the job keeps who signed
--     and when. Uploaded when the shipment is set to Delivered.
--   * Motion Warehouse releases: a POD file on the release (delivered or
--     collected), visible to the customer on the portal.

alter table public.jobs
  add column if not exists pod_signed_by text,
  add column if not exists pod_delivered_at date;

-- Customer view of shipments + POD details (appended columns).
create or replace view public.client_jobs
with (security_barrier = true) as
select j.id, j.reference, j.client_id, j.mode, j.milestone, j.shipment_status,
       j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name,
       j.carrier_name, j.provisional_delivery_date, j.etd, j.eta,
       j.origin, j.destination, j.created_at,
       s.company as supplier_company,
       j.po_no,
       j.pod_signed_by, j.pod_delivered_at
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_jobs to authenticated;

alter table public.wms_releases
  add column if not exists pod_path text,
  add column if not exists pod_name text,
  add column if not exists pod_signed_by text,
  add column if not exists pod_delivered_at date;

-- The customer can open the POD of a release it can see (0138 policy).
drop policy if exists "clients view own release pods" on storage.objects;
create policy "clients view own release pods" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shipment-documents'
    and exists (
      select 1 from public.wms_releases rl
      where rl.pod_path = storage.objects.name
        and public.my_client_id() is not null
        and (
          rl.client_id = public.my_client_id()
          or exists (
            select 1 from public.wms_release_lines l
            join public.wms_receipts r on r.id = l.receipt_id
            where l.release_id = rl.id and r.client_id = public.my_client_id()
          )
        )
    )
  );
