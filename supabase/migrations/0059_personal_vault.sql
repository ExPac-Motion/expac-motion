-- ============================================================
-- 0059  Personal Vault (Control Tower)
-- ============================================================
-- A private space for one operator: a personal income/expense budget and
-- a personal quick-actions checklist. Every row is scoped to its owner by
-- RLS (user_id = auth.uid()), so nothing here is visible to other staff
-- regardless of the route. Which account sees the "Personal Vault" tab is
-- a front-end setting (VAULT_OWNER_EMAIL in src/lib/flags.ts).
--
-- Run in the Supabase SQL editor after 0058. Self-contained & idempotent.

create table if not exists public.vault_budget_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade
              default auth.uid(),
  kind        text not null check (kind in ('income', 'expense')),
  category    text,
  amount      numeric not null default 0,
  occurred_on date not null default current_date,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists vault_budget_user_idx
  on public.vault_budget_entries (user_id, occurred_on desc);

alter table public.vault_budget_entries enable row level security;
drop policy if exists "own rows" on public.vault_budget_entries;
create policy "own rows" on public.vault_budget_entries
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.vault_todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade
              default auth.uid(),
  title       text not null default '',
  done        boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists vault_todos_user_idx
  on public.vault_todos (user_id, sort_order, created_at);

alter table public.vault_todos enable row level security;
drop policy if exists "own rows" on public.vault_todos;
create policy "own rows" on public.vault_todos
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
