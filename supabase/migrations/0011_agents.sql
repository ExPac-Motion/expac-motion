-- ============================================================
-- 0011  Agents: clearing & forwarding agent contact records
-- ============================================================
-- Same shape as clients / suppliers, including the trade-detail
-- columns from 0009 / 0010.
--
-- Run in the Supabase SQL editor after 0010. Self-contained & idempotent.

create table if not exists public.agents (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  contact     text,
  email       text,
  phone       text,
  vat_no      text,
  import_code text,
  address     text,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.agents enable row level security;
drop policy if exists "team full access" on public.agents;
create policy "team full access" on public.agents
  for all to authenticated using (true) with check (true);
