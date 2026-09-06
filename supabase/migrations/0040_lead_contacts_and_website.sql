-- ============================================================
-- 0040  Sales CRM: lead website + additional contacts per company
-- ============================================================
-- `leads.contact` / `email` / `phone` stay the primary contact (used
-- everywhere already). This adds a company website field and a child
-- table for extra people at the same prospect company.
--
-- Run in the Supabase SQL editor after 0038. Self-contained & idempotent.
-- (Numbered 0040 to stay clear of migrations from parallel work; a gap
--  in the sequence is harmless -- they run in filename order.)

alter table public.leads
  add column if not exists website text;

create table if not exists public.lead_contacts (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  name       text not null default '',
  role       text,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index if not exists lead_contacts_lead_idx on public.lead_contacts (lead_id);

alter table public.lead_contacts enable row level security;
drop policy if exists "team full access" on public.lead_contacts;
create policy "team full access" on public.lead_contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
