-- ============================================================
-- 0085  Personal Vault — Expense Control posts to the Budget ledger
-- ============================================================
-- vault_todos (Expense Control) gains the same Personal/Business scope as
-- vault_budget_entries, plus a link to the Budget entry created for it the
-- moment it's marked Transferred. The client (db.ts) manages that link:
-- create on first transfer, keep it in sync while transferred, delete if
-- un-transferred or the Expense Control row itself is removed.
--
-- Run in the Supabase SQL editor after 0084. Self-contained & idempotent.

alter table public.vault_todos
  add column if not exists scope text not null default 'personal';
alter table public.vault_todos
  drop constraint if exists vault_todos_scope_check;
alter table public.vault_todos
  add constraint vault_todos_scope_check check (scope in ('personal', 'business'));

alter table public.vault_todos
  add column if not exists linked_budget_entry_id uuid
  references public.vault_budget_entries (id) on delete set null;

create index if not exists vault_todos_scope_idx
  on public.vault_todos (user_id, scope, sort_order, created_at);
