-- ============================================================
-- 0168  Masters & Houses: selectable house status + where received
-- ============================================================
-- A house's status was only worked out (Awaiting cargo → Received at OUR
-- warehouse → Documents complete → HBL issued → Loaded). Cargo is often
-- received at the supplier's / origin warehouse instead (e.g. Shenzhen),
-- so the team can now set the status by hand (null = automatic) and note
-- where the cargo was received. The customer sees both on the portal.
--
-- Run in the Supabase SQL editor after 0167. Self-contained & idempotent.

alter table public.job_houses
  add column if not exists status text,
  add column if not exists status_at timestamptz,
  add column if not exists received_note text;
alter table public.job_houses drop constraint if exists job_houses_status_check;
alter table public.job_houses add constraint job_houses_status_check
  check (status is null or status in ('Awaiting cargo', 'Received', 'Documents complete', 'HBL issued', 'Loaded'));

create or replace view public.client_job_houses
with (security_barrier = true) as
select h.id, h.job_id, h.position, h.house_no, s.company as supplier_company,
       h.pieces, h.gross_kg, h.volume_cbm, h.commodity, h.commercial_value,
       h.value_currency, h.carrier_house_no,
       h.status, h.status_at, h.received_note
from public.job_houses h
join public.jobs j on j.id = h.job_id
left join public.suppliers s on s.id = h.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_job_houses to authenticated;

notify pgrst, 'reload schema';
