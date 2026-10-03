-- ============================================================
-- 0118  Sales CRM: editable Win Rate + Quote Turnaround targets
-- ============================================================
-- The Sales dashboard's Win Rate (50%) and Quote Turnaround (< 4 hrs)
-- targets were hard-coded; they now live with the other monthly targets
-- in company_settings and are edited from the same "Edit targets" dialog.
--
-- Run in the Supabase SQL editor after 0117. Self-contained & idempotent.

alter table public.company_settings
  add column if not exists win_rate_target             numeric not null default 50,
  add column if not exists quote_turnaround_target_hrs numeric not null default 4;
