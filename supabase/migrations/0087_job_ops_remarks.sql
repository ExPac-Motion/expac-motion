-- ============================================================
-- 0087  Shipments — ops-only Remarks (Document Vault Remarks section)
-- ============================================================
-- Free text captured on the shipment Edit form, never shown anywhere in the
-- app UI other than pre-filling the Remarks line on Document Vault print
-- documents. Not customer-visible, not synced anywhere else.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

alter table public.jobs add column if not exists ops_remarks text;
