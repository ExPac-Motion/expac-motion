-- ============================================================
-- 0165  Masters & Houses: per-house status
-- ============================================================
-- Shipments › Masters & Houses tracks each house of a master shipment
-- (0164): Awaiting cargo → Received at warehouse → Documents complete →
-- HBL / HAWB issued → Loaded. Received and Documents come from the house's
-- warehouse receipts and documents; these are the steps ExPac sets:
--   cargo_ready_date  when the supplier says the cargo is ready
--   hbl_issued_at     house bill issued
--   loaded_at         loaded / on board
--
-- Run in the Supabase SQL editor after 0164. Self-contained & idempotent.

alter table public.job_houses
  add column if not exists cargo_ready_date date,
  add column if not exists hbl_issued_at date,
  add column if not exists loaded_at date;

notify pgrst, 'reload schema';
