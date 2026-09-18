-- ============================================================
-- 0097  Personal Vault: "Amount Paid" on Budget entries
-- ============================================================
-- Lets a Budget row (an amount due) be paid off in instalments through
-- the month -- amount_paid is entered by hand as each payment happens,
-- and the app derives the remaining balance (amount - amount_paid)
-- client-side, so nothing here needs to compute it.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

alter table public.vault_budget_entries
  add column if not exists amount_paid numeric not null default 0;
