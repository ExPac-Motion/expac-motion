-- ============================================================
-- 0089  Shipments — Container Type (Sea Freight)
-- ============================================================
-- Free text (e.g. "1x 20GP", "2x 40HC") captured on the shipment Edit form
-- alongside Container No, so Document Vault documents can show it for Sea
-- Freight shipments.
--
-- Run in the Supabase SQL editor after 0088. Self-contained & idempotent.

alter table public.jobs add column if not exists container_type text;
