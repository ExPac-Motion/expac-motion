-- ============================================================
-- 0071  Portal: Customer Party (shippers) + Tariff Sheet views
-- ============================================================
-- Two more client_* security-barrier views for the portal redesign:
--
--   client_suppliers   -- the distinct shippers/suppliers used across this
--                          customer's own shipments ("Customer Party").
--   client_rate_sheet  -- the internal rate_sheet, but with buy/margin
--                          collapsed into a single sell rate -- a customer
--                          must never see cost/markup, only the price.
--
-- Run in the Supabase SQL editor after 0070.

create or replace view public.client_suppliers
with (security_barrier = true) as
select distinct
  s.id, s.company, s.contact, s.email, s.phone
from public.suppliers s
join public.jobs j on j.supplier_id = s.id
where j.client_id = public.my_client_id();

create or replace view public.client_rate_sheet
with (security_barrier = true) as
select
  r.id, r.mode, r.origin, r.destination, r.carrier, r.category,
  r.code, r.description, r.unit, r.cur,
  round(r.buy * (1 + r.margin / 100), 2) as sell
from public.rate_sheet r;

grant select on public.client_suppliers, public.client_rate_sheet to authenticated;
