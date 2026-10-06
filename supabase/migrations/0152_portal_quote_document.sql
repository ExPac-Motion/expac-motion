-- 0152: Customer Portal quotation = the same quotation document as Motion.
--
-- The portal renders Motion's own quotation sheet (QuoteSheet). It needs a
-- few more quote fields and ExPac's letterhead, still without buy cost,
-- margin or the FX table:
--   * client_quotes gains value_currency, consignee_company and sell_fx (only
--     the rate for the quote's sell currency, which the converted amounts on
--     the quotation already imply; null for a ZAR quote). Columns are appended
--     at the end, as create or replace view requires.
--   * client_letterhead: the letterhead block printed on every quotation
--     (name, reg / VAT no, contact, postal address, strapline, blurb, bank).
--
-- Run in the Supabase SQL Editor after 0151.

create or replace view public.client_quotes
with (security_barrier = true) as
select
  q.id, q.reference, q.client_id, q.mode, q.commodity, q.origin, q.destination,
  q.delivery_terms, q.valid_until, q.status, q.commercial_value,
  q.insurance_amount, q.vessel_name, q.mbl_no, q.hbl_no, q.container_no,
  q.etd, q.eta, q.incoterms, q.mawb_no, q.hawb_no, q.flight_no, q.flight_date,
  q.carrier_name, q.created_at,
  s.company as supplier_company,
  q.customer_reference, q.portal_requested_at, q.request_ready_date, q.request_pickup,
  q.request_delivery, q.request_notes, q.portal_decision, q.portal_decided_at,
  q.portal_decline_reason, q.sell_currency, q.accepted_at,
  q.wms_receipt_ids,
  q.value_currency,
  cn.company as consignee_company,
  case q.sell_currency
    when 'USD' then q.fx_usd_zar
    when 'CNY' then q.fx_cny_zar
    when 'EUR' then q.fx_eur_zar
    when 'GBP' then q.fx_gbp_zar
    else null
  end as sell_fx
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
left join public.clients cn on cn.id = q.consignee_id
where q.client_id = public.my_client_id();
grant select on public.client_quotes to authenticated;

create or replace view public.client_letterhead
with (security_barrier = true) as
select
  cs.legal_name, cs.reg_no, cs.vat_no, cs.tel, cs.email, cs.postal_address,
  cs.strapline, cs.blurb, cs.bank_details
from public.company_settings cs
where cs.id = 1 and public.my_client_id() is not null;
grant select on public.client_letterhead to authenticated;

comment on view public.client_letterhead is $$
Customer Portal: ExPac's quotation letterhead only (0152). Elevated view so
customers never read company_settings itself; rows only for a portal login.
$$;
