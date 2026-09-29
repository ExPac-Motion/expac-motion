-- Managed picklist for Lead / Customer "Source" -- previously a free-text
-- field on leads.source and clients.source (unchanged, still plain text so
-- existing values are never invalidated). This table only drives the
-- dropdown's option list; add/rename/remove entries from the CRM > Lead
-- Sources page.
--
-- Run in the Supabase SQL editor after 0103. Self-contained & idempotent.

create table if not exists public.lead_sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.lead_sources (name, sort_order) values
  ('Website', 1),
  ('Contact Page', 2),
  ('WhatsApp', 3),
  ('Referral', 4),
  ('Google', 5),
  ('Trade Show', 6)
on conflict (name) do nothing;

alter table public.lead_sources enable row level security;
drop policy if exists "team full access" on public.lead_sources;
create policy "team full access" on public.lead_sources
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
