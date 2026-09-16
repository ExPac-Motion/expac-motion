-- ============================================================
-- 0094  Auto-link a lead's pending Opportunity when its first quote lands
-- ============================================================
-- A real Opportunity record (created by hand, or automatically for every
-- web-form Lead since 0093) starts with no quote_id. Nothing has ever
-- linked one up when staff later builds an actual quote for that lead --
-- the Opportunity just sits there at its stored value forever, while the
-- new quote shows up as its own separate synthetic pipeline card. Result:
-- two cards for the same enquiry, and the real one never reflects the
-- quote's total (see 0093's sibling fix in the app: OpportunitiesTab /
-- SalesDashboardTab / TrendsTab now compute a linked opportunity's value
-- live from its quote -- but only once quote_id is actually set).
--
-- Widen save_quote so that creating a brand-new quote (p_id is null) for a
-- lead auto-links the most recently created still-unlinked Opportunity for
-- that same lead. Only fires on creation, never on an edit of an existing
-- quote, and only touches an Opportunity with no quote_id yet -- an
-- already-linked or manually-managed one is left alone.
--
-- Run in the Supabase SQL editor after 0093. Self-contained & idempotent
-- (CREATE OR REPLACE — safe to re-run; the function signature is
-- unchanged from 0090, so no DROP FUNCTION is needed).

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
  p_shipping_line     text default null,
  p_consignee_id      uuid default null,
  p_fx_eur_zar        numeric default 0,
  p_sell_currency     text default null,
  p_value_currency    text default 'ZAR',
  p_consignee_lead_id uuid default null,
  p_container_type    text default null,
  p_provisional_delivery_date date default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
  v_is_new boolean;
begin
  v_is_new := p_id is null;

  if v_is_new then
    insert into public.quotes
      (reference, client_id, supplier_id, agent_id, transporter_id,
       clearing_agent_id, mode, commodity, origin, destination, delivery_terms,
       valid_until, status, commercial_value, insurance_amount, incoterms,
       vessel_name, mbl_no, hbl_no, container_no, etd, eta, mawb_no, hawb_no,
       flight_no, flight_date, carrier_name, fx_usd_zar, fx_cny_zar, lead_id,
       sales_person_id, customer_reference, shipping_line, consignee_id,
       fx_eur_zar, sell_currency, value_currency, consignee_lead_id,
       container_type, provisional_delivery_date)
    values
      (p_reference, p_client_id, p_supplier_id, p_agent_id, p_transporter_id,
       p_clearing_agent_id, p_mode, p_commodity, p_origin, p_destination,
       p_delivery_terms, p_valid_until, p_status, p_commercial_value,
       p_insurance_amount, p_incoterms, p_vessel_name, p_mbl_no, p_hbl_no,
       p_container_no, p_etd, p_eta, p_mawb_no, p_hawb_no, p_flight_no,
       p_flight_date, p_carrier_name,
       coalesce(p_fx_usd_zar, 0), coalesce(p_fx_cny_zar, 0), p_lead_id,
       p_sales_person_id, p_customer_reference, p_shipping_line, p_consignee_id,
       coalesce(p_fx_eur_zar, 0), nullif(p_sell_currency, ''),
       coalesce(nullif(p_value_currency, ''), 'ZAR'), p_consignee_lead_id,
       p_container_type, p_provisional_delivery_date)
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
      consignee_id       = p_consignee_id,
      fx_eur_zar         = coalesce(p_fx_eur_zar, 0),
      sell_currency      = nullif(p_sell_currency, ''),
      value_currency     = coalesce(nullif(p_value_currency, ''), 'ZAR'),
      consignee_lead_id  = p_consignee_lead_id,
      container_type     = p_container_type,
      provisional_delivery_date = p_provisional_delivery_date,
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

  -- A brand-new quote for a lead that already has an unlinked Opportunity
  -- (e.g. the one auto-created from a web-form submission) adopts it,
  -- instead of leaving it stranded at its stale value while the quote
  -- shows up as its own separate synthetic card.
  if v_is_new and p_lead_id is not null then
    update public.opportunities
       set quote_id = v_id, updated_at = now()
     where id = (
       select id from public.opportunities
        where lead_id = p_lead_id and quote_id is null
        order by created_at desc
        limit 1
     );
  end if;

  return v_id;
end;
$$;

-- One-time backfill: link any already-orphaned Opportunity (quote_id still
-- null -- e.g. one auto-created from a web-form Lead between 0093 shipping
-- and this migration) to the earliest existing quote for the same lead, so
-- it stops showing a stale value and duplicating that quote's own
-- synthetic pipeline card. Safe to re-run: only ever touches quote_id IS
-- NULL rows, so it's a no-op once everything is linked.
update public.opportunities o
   set quote_id = q.id, updated_at = now()
  from (
    select distinct on (lead_id) id, lead_id
      from public.quotes
     where lead_id is not null
     order by lead_id, created_at asc
  ) q
 where o.lead_id = q.lead_id
   and o.quote_id is null;
