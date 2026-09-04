-- ============================================================
-- 0020  Shipments board — Carrier/Airline Name column
-- ============================================================
-- jobs.carrier_name, backfilled from the quote's Carrier/Airline Name field
-- (already captured on every quote, src/pages/QuoteBuilderPage.tsx). Shown
-- on the Active/Completed Shipments board in place of Vessel Name (which
-- stays in the schema — the Sea customer-update email still uses it).
--
-- Run in the Supabase SQL editor after 0019. Self-contained & idempotent.

alter table public.jobs
  add column if not exists carrier_name text;

update public.jobs j
   set carrier_name = q.carrier_name
  from public.quotes q
 where j.quote_id = q.id
   and (j.carrier_name is null or j.carrier_name = '')
   and coalesce(q.carrier_name, '') <> '';

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
       mode, milestone, shipment_status, etd, eta, awb_mbl, container_no,
       vessel_name, carrier_name)
    values
      (q.id, q.reference, q.client_id, q.supplier_id, q.origin, q.destination,
       q.mode, 'Booked', 'Booked', q.etd, q.eta,
       case
         when q.mode like 'Air%' or q.mode like 'Courier%'
           then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
         when q.mode like 'Sea%'
           then coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
         else null
       end,
       nullif(q.container_no, ''),
       nullif(q.vessel_name, ''),
       nullif(q.carrier_name, ''))
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;
