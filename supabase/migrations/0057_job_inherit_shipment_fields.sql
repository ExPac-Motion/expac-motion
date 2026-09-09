-- ============================================================
-- 0057  Shipments inherit the quote's booking fields
-- ============================================================
-- 0055 restored supplier_id on accept_quote's jobs INSERT. The same
-- rewrite had also dropped the rest of the booking details, so a shipment
-- created from an accepted quote showed blank MBL/AWB No, Container No,
-- ETD, ETA, Agent/Airline and Vessel even when the quotation had them.
--
-- Add those to the INSERT (mapped to the job's single awb_mbl field by
-- mode), and backfill existing shipments — filling BLANKS only, so a value
-- the ops team already edited on the shipment is never overwritten.
--
-- Run in the Supabase SQL editor after 0056. Self-contained & idempotent.

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

  -- one job field, picked from the mode-appropriate quote field
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
       awb_mbl, container_no, etd, eta, carrier_name, vessel_name)
    values
      (q.id, q.reference, nullif(trim(q.customer_reference), ''),
       v_client_id, q.supplier_id, q.origin, q.destination, q.mode, 'Booked',
       v_awb_mbl, nullif(q.container_no, ''), q.etd, q.eta,
       nullif(q.carrier_name, ''), nullif(q.vessel_name, ''))
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');

    insert into public.ops_tasks (kind, title, status, priority, job_id, quote_id, client_id)
    values
      ('task', 'Request commercial invoice', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Book carrier', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Send booking confirmation to customer', 'open', 'normal', v_job_id, q.id, v_client_id);
  end if;

  return v_job_id;
end;
$$;

-- Backfill existing shipments — blanks only, never overwrite an ops edit.
update public.jobs j set
  supplier_id  = coalesce(j.supplier_id, q.supplier_id),
  awb_mbl      = coalesce(nullif(j.awb_mbl, ''),
                   case
                     when q.mode ilike 'air%' or q.mode ilike 'courier%'
                       then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
                     else coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
                   end),
  container_no = coalesce(nullif(j.container_no, ''), nullif(q.container_no, '')),
  etd          = coalesce(j.etd, q.etd),
  eta          = coalesce(j.eta, q.eta),
  carrier_name = coalesce(nullif(j.carrier_name, ''), nullif(q.carrier_name, '')),
  vessel_name  = coalesce(nullif(j.vessel_name, ''), nullif(q.vessel_name, ''))
from public.quotes q
where j.quote_id = q.id
  and (
    (j.supplier_id is null and q.supplier_id is not null) or
    (nullif(j.awb_mbl, '') is null
       and coalesce(nullif(q.mbl_no,''), nullif(q.hbl_no,''),
                    nullif(q.mawb_no,''), nullif(q.hawb_no,'')) is not null) or
    (nullif(j.container_no, '') is null and nullif(q.container_no, '') is not null) or
    (j.etd is null and q.etd is not null) or
    (j.eta is null and q.eta is not null) or
    (nullif(j.carrier_name, '') is null and nullif(q.carrier_name, '') is not null) or
    (nullif(j.vessel_name, '') is null and nullif(q.vessel_name, '') is not null)
  );
