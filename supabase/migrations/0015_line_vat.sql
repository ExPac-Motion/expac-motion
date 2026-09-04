-- ============================================================
-- 0015  Per-line VAT %
-- ============================================================
-- Adds quote_lines.vat_pct. The customer quotation letterhead uses it to
-- show VAT per charge line plus a VAT subtotal and a total incl. VAT.
-- VAT travels inside p_lines (jsonb), so save_quote keeps the same
-- signature — create-or-replace is enough and only the line insert changes.
--
-- Run in the Supabase SQL editor after 0014. Self-contained & idempotent.

alter table public.quote_lines
  add column if not exists vat_pct numeric not null default 0;

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
  p_packing           jsonb
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
       flight_no, flight_date, carrier_name, fx_usd_zar, fx_cny_zar)
    values
      (p_reference, p_client_id, p_supplier_id, p_agent_id, p_transporter_id,
       p_clearing_agent_id, p_mode, p_commodity, p_origin, p_destination,
       p_delivery_terms, p_valid_until, p_status, p_commercial_value,
       p_insurance_amount, p_incoterms, p_vessel_name, p_mbl_no, p_hbl_no,
       p_container_no, p_etd, p_eta, p_mawb_no, p_hawb_no, p_flight_no,
       p_flight_date, p_carrier_name,
       coalesce(p_fx_usd_zar, 0), coalesce(p_fx_cny_zar, 0))
    returning id into v_id;
  else
    update public.quotes set
      reference         = p_reference,
      client_id         = p_client_id,
      supplier_id       = p_supplier_id,
      agent_id          = p_agent_id,
      transporter_id    = p_transporter_id,
      clearing_agent_id = p_clearing_agent_id,
      mode              = p_mode,
      commodity         = p_commodity,
      origin            = p_origin,
      destination       = p_destination,
      delivery_terms    = p_delivery_terms,
      valid_until       = p_valid_until,
      status            = p_status,
      commercial_value  = p_commercial_value,
      insurance_amount  = p_insurance_amount,
      incoterms         = p_incoterms,
      vessel_name       = p_vessel_name,
      mbl_no            = p_mbl_no,
      hbl_no            = p_hbl_no,
      container_no      = p_container_no,
      etd               = p_etd,
      eta               = p_eta,
      mawb_no           = p_mawb_no,
      hawb_no           = p_hawb_no,
      flight_no         = p_flight_no,
      flight_date       = p_flight_date,
      carrier_name      = p_carrier_name,
      fx_usd_zar        = coalesce(p_fx_usd_zar, 0),
      fx_cny_zar        = coalesce(p_fx_cny_zar, 0),
      updated_at        = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Quote % not found', p_id;
    end if;
  end if;

  delete from public.quote_lines where quote_id = v_id;

  insert into public.quote_lines
    (quote_id, position, category, code, description, cur, unit, qty, buy, margin, vat_pct, sell)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(nullif(line ->> 'category', ''), 'International Freight Charges'),
    coalesce(line ->> 'code', ''),
    coalesce(line ->> 'description', ''),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce(line ->> 'unit', ''),
    coalesce((line ->> 'qty')::numeric, 0),
    coalesce((line ->> 'buy')::numeric, 0),
    coalesce((line ->> 'margin')::numeric, 0),
    coalesce((line ->> 'vat_pct')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  delete from public.packing_list_items where quote_id = v_id;

  insert into public.packing_list_items
    (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
  select
    v_id,
    coalesce((pk ->> 'position')::int, (ord - 1)::int),
    coalesce((pk ->> 'length_cm')::numeric, 0),
    coalesce((pk ->> 'width_cm')::numeric, 0),
    coalesce((pk ->> 'height_cm')::numeric, 0),
    coalesce((pk ->> 'actual_kg')::numeric, 0),
    coalesce((pk ->> 'qty_ctns')::numeric, 0)
  from jsonb_array_elements(coalesce(p_packing, '[]'::jsonb)) with ordinality as t(pk, ord);

  return v_id;
end;
$$;
