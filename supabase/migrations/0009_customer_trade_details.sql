-- ============================================================
-- 0009  Customer trade details on the clients table
-- ============================================================
-- The Customers form now captures the customer's VAT number, customs
-- import code and physical address. Plain text, all optional.
--
-- Run in the Supabase SQL editor after 0008. Self-contained & idempotent.

alter table public.clients
  add column if not exists vat_no      text,
  add column if not exists import_code text,
  add column if not exists address     text;
