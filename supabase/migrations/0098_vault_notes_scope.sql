-- ============================================================
-- 0098  Personal Vault — Business scope on Notes & Calendar
-- ============================================================
-- Same pattern as 0084 (Budget) and vault_todos (Expense Control):
-- vault_notes gains a `scope` column so the shared Personal/Business
-- toggle also filters Notes and Calendar, instead of showing every
-- note regardless of which side you're looking at. Existing rows
-- backfill to 'personal'.
--
-- Run in the Supabase SQL editor after 0097. Self-contained & idempotent.

alter table public.vault_notes
  add column if not exists scope text not null default 'personal';

alter table public.vault_notes
  drop constraint if exists vault_notes_scope_check;
alter table public.vault_notes
  add constraint vault_notes_scope_check
  check (scope in ('personal', 'business'));

create index if not exists vault_notes_scope_idx
  on public.vault_notes (user_id, scope, status, due_date);
