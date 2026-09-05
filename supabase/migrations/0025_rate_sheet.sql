-- ============================================================
-- 0025  Rates & Tariff Sheet
-- ============================================================
-- Phase 2, module 5. Replaces the Excel rate sheet: standard buy/sell
-- rates by trade lane + mode + carrier, pulled into the Quote Builder
-- instead of typing rates from memory/Excel each time.
--
-- Run in the Supabase SQL editor after 0024. Self-contained & idempotent.

create table if not exists public.rate_sheet (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null,
  origin      text,                       -- UN/LOCODE, blank = any lane
  destination text,
  carrier     text,
  category    text not null default 'International Freight Charges',
  code        text,
  description text not null,
  unit        text,
  cur         text not null default 'USD',
  buy         numeric not null default 0,
  margin      numeric not null default 0, -- % markup, matches quote lines
  notes       text,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists rate_sheet_mode_idx on public.rate_sheet (mode);

alter table public.rate_sheet enable row level security;
drop policy if exists "team full access" on public.rate_sheet;
create policy "team full access" on public.rate_sheet
  for all to authenticated using (true) with check (true);
