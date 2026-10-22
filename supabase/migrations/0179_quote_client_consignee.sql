-- ============================================================
-- 0179  Quote consignee from the customer's own consignee list
-- ============================================================
-- The Quote Builder's Consignee/Delivery Point listed every Customer and
-- Lead, not the consignees kept on the customer's record (client_consignees,
-- 0142). With a customer picked, the builder now offers only that
-- customer's consignees, stored here.
--
--   1. quotes.client_consignee_id -> client_consignees (cleared if the
--      consignee is deleted). consignee_id / consignee_lead_id stay for
--      existing quotes and quotes without a customer.
--   2. client_quotes (portal, 0153): consignee_company prefers it.
--
-- Run in the Supabase SQL editor after 0178. Self-contained & idempotent.

alter table public.quotes
  add column if not exists client_consignee_id uuid
    references public.client_consignees (id) on delete set null;

create index if not exists quotes_client_consignee_idx
  on public.quotes (client_consignee_id);

-- Customer view of quotes (0153), consignee_company now prefers the
-- customer's own consignee.
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
  coalesce(cc.company, cn.company) as consignee_company,
  case q.sell_currency
    when 'USD' then q.fx_usd_zar
    when 'CNY' then q.fx_cny_zar
    when 'EUR' then q.fx_eur_zar
    when 'GBP' then q.fx_gbp_zar
    else null
  end as sell_fx,
  q.revision_no,
  q.revision_pending
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
left join public.clients cn on cn.id = q.consignee_id
left join public.client_consignees cc on cc.id = q.client_consignee_id
where q.client_id = public.my_client_id();
grant select on public.client_quotes to authenticated;
