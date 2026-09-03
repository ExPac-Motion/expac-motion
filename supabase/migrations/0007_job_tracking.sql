-- ============================================================
-- 0007  Job tracking: make Active Jobs a fully editable board
-- ============================================================
-- Adds the operational fields that get filled in / updated as a job runs:
-- supplier, PO number, shipment status, free-text notes, AWB/MBL number,
-- ETD, ETA. Ports (origin/destination) already exist on jobs.
--
-- shipment_status is a plain text column on purpose — the list of statuses
-- is maintained on the client (SHIPMENT_STATUSES in src/lib/types.ts) and
-- will change over time; no CHECK constraint to fight with.
--
-- Run in the Supabase SQL editor after 0006. Self-contained & idempotent.

alter table public.jobs
  add column if not exists supplier_id     uuid references public.suppliers (id) on delete set null,
  add column if not exists po_no           text,
  add column if not exists shipment_status text,
  add column if not exists notes           text,
  add column if not exists awb_mbl         text,
  add column if not exists etd             date,
  add column if not exists eta             date;

-- Backfill supplier from the linked quote, and seed a shipment status from
-- the existing milestone so nothing shows blank on first load.
update public.jobs j
   set supplier_id = q.supplier_id
  from public.quotes q
 where j.quote_id = q.id
   and j.supplier_id is null;

update public.jobs
   set shipment_status = milestone
 where shipment_status is null;

-- accept_quote now also copies the supplier and seeds the shipment status.
create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id uuid;
  q        public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  update public.quotes
     set status = 'accepted', updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, client_id, supplier_id, origin, destination,
       mode, milestone, shipment_status)
    values
      (q.id, q.reference, q.client_id, q.supplier_id, q.origin, q.destination,
       q.mode, 'Booked', 'Booked')
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;
