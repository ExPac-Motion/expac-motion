-- ============================================================
-- 0084  Personal Vault — Business scope on the budget ledger
-- ============================================================
-- One combined ledger rather than a second table: vault_budget_entries
-- gains a `scope` column ('personal' | 'business') so the same Budget
-- section can track both, filtered by a Personal/Business toggle in the
-- UI, instead of two separate panels. Existing rows backfill to 'personal'
-- (everything logged so far was personal spending).
--
-- Run in the Supabase SQL editor after 0083. Self-contained & idempotent.

alter table public.vault_budget_entries
  add column if not exists scope text not null default 'personal';

alter table public.vault_budget_entries
  drop constraint if exists vault_budget_entries_scope_check;
alter table public.vault_budget_entries
  add constraint vault_budget_entries_scope_check
  check (scope in ('personal', 'business'));

create index if not exists vault_budget_scope_idx
  on public.vault_budget_entries (user_id, scope, occurred_on desc);
