-- ============================================================
-- 0060  Per-user table column layout
-- ============================================================
-- Remembers each user's column order + widths for the list tables
-- (Quotations first, then Shipments / Customers / Suppliers). One row per
-- user per table, RLS-locked to the owner.
--
-- Run in the Supabase SQL editor after 0059. Self-contained & idempotent.

create table if not exists public.ui_table_prefs (
  user_id    uuid not null references auth.users (id) on delete cascade
             default auth.uid(),
  table_key  text not null,
  layout     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, table_key)
);

alter table public.ui_table_prefs enable row level security;
drop policy if exists "own rows" on public.ui_table_prefs;
create policy "own rows" on public.ui_table_prefs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
