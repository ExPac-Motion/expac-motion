-- ============================================================
-- 0062  Configurable shipment-notification email templates
-- ============================================================
-- Settings -> Shipment Comms lets the team edit the customer update email
-- per freight group (Air / Sea / Courier / Road) using merge codes. Overrides
-- are kept as a jsonb blob on the single-row company_settings table; any key
-- or field left unset falls back to the built-in defaults in
-- src/lib/mailTemplates.ts. Shape:
--   { "sea": { "subject": "...", "body": "..." }, "air": { ... }, ... }
--
-- Run in the Supabase SQL editor after 0061. Self-contained & idempotent.

alter table public.company_settings
  add column if not exists shipment_comms jsonb not null default '{}'::jsonb;
