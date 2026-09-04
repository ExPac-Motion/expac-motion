-- ============================================================
-- 0010  Trade details on the suppliers (shippers) table
-- ============================================================
-- Mirrors 0009: the Shippers form now captures VAT number, customs
-- code and physical address. Plain text, all optional.
--
-- Run in the Supabase SQL editor after 0009. Self-contained & idempotent.

alter table public.suppliers
  add column if not exists vat_no      text,
  add column if not exists import_code text,
  add column if not exists address     text;
