-- ============================================================
-- 0070  Shipment Replies — a lightweight template for chat-style messages
-- ============================================================
-- Shipment Comms (0062) always sends the full per-mode status-update
-- template (customer/status/vessel/container/etc.) even for a quick
-- back-and-forth reply, which reads oddly repeated in every message of a
-- thread. This adds a second, parallel per-mode template set — Settings
-- -> Shipment Replies — for that case: just the operator's message plus
-- signature, no shipment-data block. Same jsonb-override shape as
-- shipment_comms; see DEFAULT_SHIPMENT_REPLIES in mailTemplates.ts for the
-- built-in default.
--
-- Run in the Supabase SQL editor after 0069.

alter table public.company_settings
  add column if not exists shipment_replies jsonb not null default '{}'::jsonb;
