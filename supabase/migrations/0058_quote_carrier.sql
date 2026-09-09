-- ============================================================
-- 0058  Carrier (shipping line) captured on the quotation
-- ============================================================
-- The shipment board has a "Carrier" column (job.shipping_line) but the
-- quotation had no field to seed it from. Add quotes.shipping_line, widen
-- save_quote to persist it, and have accept_quote copy it onto the job.
--
-- Run in the Supabase SQL editor after 0057. Self-contained & idempotent.

alter table public.quotes add column if not exists shipping_line text;

-- ---- save_quote gains p_shipping_line -----------------------------------
drop function if exists public.save_quote(
  uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, date,
  text, numeric, numeric, text, text, text, text, text, date, date, text, text,
  text, date, text, numeric, numeric, jsonb, jsonb, uuid, uuid, text
);

create or replace function public.save_quote(
  p_id                uuid,
  p_reference         text,
  p_client_id         uuid,
  p_supplier_id       uuid,
  p_agent_id          uuid,
  p_transporter_id    uuid,
  p_clearing_agent_id uuid,
  p_mode              text,
  p_commodity         text,
  p_origin            text,
  p_destination       text,
  p_delivery_terms    text,
  p_valid_until       date,
  p_status            text,
  p_commercial_value  numeric,
  p_insurance_amount  numeric,
  p_incoterms         text,
  p_vessel_name       text,
  p_mbl_no            text,
  p_hbl_no            text,
  p_container_no      text,
  p_etd               date,
  p_eta               date,
  p_mawb_no           text,
  p_hawb_no           text,
  p_flight_no         text,
  p_flight_date       date,
  p_carrier_name      text,
  p_fx_usd_zar        numeric,
  p_fx_cny_zar        numeric,
  p_lines             jsonb,
  p_packing           jsonb,
  p_lead_id           uuid default null,
  p_sales_person_id   uuid default null,
  p_customer_reference text default null,
  p_shipping_line     text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.quotes
      (reference, client_id, supplier_id, agent_id, transporter_id,
       clearing_agent_id, mode, commodity, origin, destination, delivery_terms,
       valid_until, status, commercial_value, insurance_amount, incoterms,
       vessel_name, mbl_no, hbl_no, container_no, etd, eta, mawb_no, hawb_no,
       flight_no, flight_date, carrier_name, fx_usd_zar, fx_cny_zar, lead_id,
       sales_person_id, customer_reference, shipping_line)
    values
      (p_reference, p_client_id, p_supplier_id, p_agent_id, p_transporter_id,
       p_clearing_agent_id, p_mode, p_commodity, p_origin, p_destination,
       p_delivery_terms, p_valid_until, p_status, p_commercial_value,
       p_insurance_amount, p_incoterms, p_vessel_name, p_mbl_no, p_hbl_no,
       p_container_no, p_etd, p_eta, p_mawb_no, p_hawb_no, p_flight_no,
       p_flight_date, p_carrier_name,
       coalesce(p_fx_usd_zar, 0), coalesce(p_fx_cny_zar, 0), p_lead_id,
       p_sales_person_id, p_customer_reference, p_shipping_line)
    returning id into v_id;
  else
    update public.quotes set
      reference          = p_reference,
      client_id          = p_client_id,
      supplier_id        = p_supplier_id,
      agent_id           = p_agent_id,
      transporter_id     = p_transporter_id,
      clearing_agent_id  = p_clearing_agent_id,
      mode               = p_mode,
      commodity          = p_commodity,
      origin             = p_origin,
      destination        = p_destination,
      delivery_terms     = p_delivery_terms,
      valid_until        = p_valid_until,
      status             = p_status,
      commercial_value   = p_commercial_value,
      insurance_amount   = p_insurance_amount,
      incoterms          = p_incoterms,
      vessel_name        = p_vessel_name,
      mbl_no             = p_mbl_no,
      hbl_no             = p_hbl_no,
      container_no       = p_container_no,
      etd                = p_etd,
      eta                = p_eta,
      mawb_no            = p_mawb_no,
      hawb_no            = p_hawb_no,
      flight_no          = p_flight_no,
      flight_date        = p_flight_date,
      carrier_name       = p_carrier_name,
      fx_usd_zar         = coalesce(p_fx_usd_zar, 0),
      fx_cny_zar         = coalesce(p_fx_cny_zar, 0),
      lead_id            = p_lead_id,
      sales_person_id    = p_sales_person_id,
      customer_reference = p_customer_reference,
      shipping_line      = p_shipping_line,
      updated_at         = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Quote % not found', p_id;
    end if;
  end if;

  delete from public.quote_lines where quote_id = v_id;

  insert into public.quote_lines
    (quote_id, position, category, code, description, cur, unit, qty,
     qty_override, fee_rate, buy, margin, vat_pct, sell)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(nullif(line ->> 'category', ''), 'International Freight Charges'),
    coalesce(line ->> 'code', ''),
    coalesce(line ->> 'description', ''),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce(line ->> 'unit', ''),
    coalesce((line ->> 'qty')::numeric, 0),
    coalesce((line ->> 'qty_override')::boolean, false),
    nullif(line ->> 'fee_rate', '')::numeric,
    coalesce((line ->> 'buy')::numeric, 0),
    coalesce((line ->> 'margin')::numeric, 0),
    coalesce((line ->> 'vat_pct')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  delete from public.packing_list_items where quote_id = v_id;

  insert into public.packing_list_items
    (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns, cbm)
  select
    v_id,
    coalesce((pk ->> 'position')::int, (ord - 1)::int),
    coalesce((pk ->> 'length_cm')::numeric, 0),
    coalesce((pk ->> 'width_cm')::numeric, 0),
    coalesce((pk ->> 'height_cm')::numeric, 0),
    coalesce((pk ->> 'actual_kg')::numeric, 0),
    coalesce((pk ->> 'qty_ctns')::numeric, 0),
    nullif(pk ->> 'cbm', '')::numeric
  from jsonb_array_elements(coalesce(p_packing, '[]'::jsonb)) with ordinality as t(pk, ord);

  return v_id;
end;
$$;

-- ---- accept_quote also carries shipping_line onto the job --------------
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
       awb_mbl, container_no, etd, eta, carrier_name, vessel_name, shipping_line)
    values
      (q.id, q.reference, nullif(trim(q.customer_reference), ''),
       v_client_id, q.supplier_id, q.origin, q.destination, q.mode, 'Booked',
       v_awb_mbl, nullif(q.container_no, ''), q.etd, q.eta,
       nullif(q.carrier_name, ''), nullif(q.vessel_name, ''),
       nullif(q.shipping_line, ''))
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

-- Backfill shipments' Carrier from their quote (blanks only).
update public.jobs j
   set shipping_line = q.shipping_line
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.shipping_line, '') is null
   and nullif(q.shipping_line, '') is not null;
