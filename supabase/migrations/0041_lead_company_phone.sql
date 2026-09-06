-- ============================================================
-- 0041  Sales CRM: lead company phone
-- ============================================================
-- `leads.phone` is the primary contact's mobile; this adds a separate
-- company switchboard / landline number.
--
-- Run in the Supabase SQL editor after 0040. Self-contained & idempotent.

alter table public.leads
  add column if not exists company_phone text;
