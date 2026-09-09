-- ============================================================
-- 0061  Personal Vault — "Expense Control" columns
-- ============================================================
-- The vault's second panel changes from a plain quick-actions checklist
-- into a small forecast sheet: each row is a forecasted expense plus the
-- account it was (or will be) transferred to. Reuses vault_todos.title as
-- the expense name and adds two columns.
--
-- Run in the Supabase SQL editor after 0060. Idempotent.

alter table public.vault_todos
  add column if not exists forecasted     numeric not null default 0,
  add column if not exists transferred_to text;
