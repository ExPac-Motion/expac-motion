-- ============================================================
-- 0023  Settings: company details, quote defaults, team roles
-- ============================================================
-- Phase 2, module 2. Single-row company_settings table (id is always 1) —
-- edited from the new Settings page instead of the hardcoded src/lib/company.ts
-- object. profiles gets a simple role flag (admin/user, no enforcement yet,
-- per the brief: "keep simple, no need for granular permissions yet").
--
-- Run in the Supabase SQL editor after 0022. Self-contained & idempotent.

alter table public.profiles
  add column if not exists role text not null default 'user';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'user'));

-- Any team member can manage any other team member's name/role — matches the
-- single-tenant "every authenticated user is an ExPac team member" model used
-- everywhere else, not a real per-role permission system.
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles
  for update to authenticated using (true) with check (true);

-- Backfill: any existing auth.users row that predates the handle_new_user
-- trigger (or slipped through it) gets its profiles row created now.
insert into public.profiles (id, full_name)
select id, coalesce(raw_user_meta_data ->> 'full_name', email)
from auth.users
on conflict (id) do nothing;

create table if not exists public.company_settings (
  id                 smallint primary key default 1 check (id = 1),
  legal_name         text not null default 'EXPAC FORWARDING CC',
  reg_no             text not null default '2010/110405/23',
  vat_no             text not null default '4670306135',
  tel                text not null default '+27 (0) 11 568 8281',
  email              text not null default 'support@expac.co.za',
  postal_address     text not null default 'Postnet Suite 84, Private Bag X1015, Lyttelton, 0140',
  strapline          text not null default 'Air & Ocean Freight Clearing & Forwarding',
  blurb              text not null default
    'We move more than just cargo, we move trust, time,
and opportunity. Rooted in precision and propelled
by passion, we specialize in seamless air, sea, and
road freight solutions that connect businesses
across borders. With a global mindset and local
expertise, we deliver tailored logistics with
unmatched reliability, speed, and care.',
  bank_details       text not null default
    'Bank Name: First National Bank
Branch Name: Centurion, South Africa
Account Name: ExPac Forwarding
Account Type: Business Current
Account Number (ZAR): 63215955452
Branch Code: 250655
Swift Code: FIRNZAJJ',
  default_fx_usd_zar numeric not null default 18.50,
  default_fx_cny_zar numeric not null default 2.60,
  default_vat_pct    numeric not null default 15,
  default_incoterm   text not null default 'EXW',
  updated_at         timestamptz not null default now()
);

insert into public.company_settings (id) values (1) on conflict (id) do nothing;

alter table public.company_settings enable row level security;
drop policy if exists "team full access" on public.company_settings;
create policy "team full access" on public.company_settings
  for all to authenticated using (true) with check (true);
