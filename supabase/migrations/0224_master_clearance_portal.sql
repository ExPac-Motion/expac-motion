-- ============================================================
-- 0224  Masters & houses, step 2: clearance basis + the portal
-- ============================================================
-- * jobs.clearance_basis on a master: 'master' (one clearance for the whole
--   consol) or 'house' (each house cleared on its own documents), depending
--   on the incoterm. Null = not set yet.
-- * client_jobs (portal) gains shipment_kind, master_job_id, house_no and
--   clearance_basis, so the customer sees HBL161005-1 on a house and the
--   houses on a master. Columns are appended (create or replace view).
--
-- Run in the Supabase SQL editor after 0223. Self-contained & idempotent.

alter table public.jobs add column if not exists clearance_basis text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_clearance_basis_chk') then
    alter table public.jobs
      add constraint jobs_clearance_basis_chk check (clearance_basis is null or clearance_basis in ('master', 'house'));
  end if;
end;
$$;

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
       j.shipment_kind, j.master_job_id, j.house_no, j.clearance_basis
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_jobs to authenticated;

-- * The master's status carries its houses forward (never back): once the
--   consol is Loaded / Departed / Arrived ..., every house that is behind
--   moves up too, with the same timeline entry Motion WMS writes. Each
--   house's own WMS hub then releases / receives its cargo as usual.
create or replace function public.jobs_master_status_down()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  h record;
begin
  if nullif(btrim(coalesce(new.shipment_status, '')), '') is null then
    return null;
  end if;
  for h in select id from public.jobs where master_job_id = new.id loop
    perform public.wms_advance_job_status(h.id, new.shipment_status, 'master ' || new.reference);
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_jobs_master_status_down on public.jobs;
create trigger trg_jobs_master_status_down
  after update of shipment_status on public.jobs
  for each row when (new.shipment_status is distinct from old.shipment_status)
  execute function public.jobs_master_status_down();
