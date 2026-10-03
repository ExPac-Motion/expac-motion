-- ============================================================
-- 0119  Rates & Tariff: tier rate sheets + partner rate sheets
-- ============================================================
-- Partner rate sheets: each Agent / Transporter / Clearing Agent keeps its
-- buy rates on the same code worksheet as the Quote Builder (AF-01, OR-01,
-- TR-01 ...), one sheet per mode + trade route. Any code can carry weight
-- breaks (e.g. AF-01 0-45KG / 0-100KG ..., OR-01 pick-up tiers), picked by
-- the quote's chargeable weight. Laid out so partners can later log in to a
-- vendor profile and update their own sheets.
--
--   lines = { "AF-01": { buy, cur, breaks: [{ label: "0-45KG", rate }] }, ... }
--
-- Tier rate sheets: Platinum / Gold / Silver, one sheet per tier per mode +
-- trade route. Each links an agent / transporter / clearing agent and one of
-- their partner rate sheets; a line's buy follows that partner's rate for the
-- same code live, plus the tier margin (Platinum 10 / Gold 15 / Silver 18
-- by default) unless a line overrides it.
--
--   lines = { "AF-01": { source: "agent"|"transporter"|"clearing_agent"|"manual",
--                        buy, margin (null = tier margin), sell }, ... }
--
-- Customers get a rate tier (Silver by default); quotes remember the tier
-- and tier sheet they were priced from.
--
-- Run in the Supabase SQL editor after 0118. Self-contained & idempotent.

-- ---------- Partner rate sheets ----------
create table if not exists public.partner_rate_sheets (
  id           uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent')),
  partner_id   uuid not null,
  mode         text not null,
  route        text not null,
  origin       text,
  destination  text,
  valid_from   date,
  valid_until  date,
  notes        text,
  lines        jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists partner_rate_sheets_partner_idx
  on public.partner_rate_sheets (partner_kind, partner_id);

alter table public.partner_rate_sheets enable row level security;
drop policy if exists "team full access" on public.partner_rate_sheets;
create policy "team full access" on public.partner_rate_sheets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Remove a partner's rate sheets when the partner is deleted (partner_id is
-- polymorphic, so no foreign key can do it).
create or replace function public.delete_partner_rate_sheets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.partner_rate_sheets
   where partner_kind = tg_argv[0] and partner_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_agents_rate_sheets on public.agents;
create trigger trg_agents_rate_sheets after delete on public.agents
  for each row execute function public.delete_partner_rate_sheets('agent');
drop trigger if exists trg_transporters_rate_sheets on public.transporters;
create trigger trg_transporters_rate_sheets after delete on public.transporters
  for each row execute function public.delete_partner_rate_sheets('transporter');
drop trigger if exists trg_clearing_agents_rate_sheets on public.clearing_agents;
create trigger trg_clearing_agents_rate_sheets after delete on public.clearing_agents
  for each row execute function public.delete_partner_rate_sheets('clearing_agent');

-- ---------- Tier rate sheets ----------
create table if not exists public.tariff_sheets (
  id                      uuid primary key default gen_random_uuid(),
  tier                    text not null check (tier in ('platinum', 'gold', 'silver')),
  mode                    text not null,
  route                   text not null,
  origin                  text,
  destination             text,
  valid_from              date,
  valid_until             date,
  margin                  numeric not null default 18,
  agent_id                uuid references public.agents (id) on delete set null,
  agent_sheet_id          uuid references public.partner_rate_sheets (id) on delete set null,
  transporter_id          uuid references public.transporters (id) on delete set null,
  transporter_sheet_id    uuid references public.partner_rate_sheets (id) on delete set null,
  clearing_agent_id       uuid references public.clearing_agents (id) on delete set null,
  clearing_agent_sheet_id uuid references public.partner_rate_sheets (id) on delete set null,
  notes                   text,
  lines                   jsonb not null default '{}'::jsonb,
  created_by              uuid references auth.users (id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists tariff_sheets_tier_mode_idx on public.tariff_sheets (tier, mode);

alter table public.tariff_sheets enable row level security;
drop policy if exists "team full access" on public.tariff_sheets;
create policy "team full access" on public.tariff_sheets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- Customer tier + quote tier ----------
alter table public.clients
  add column if not exists rate_tier text not null default 'silver';
alter table public.clients drop constraint if exists clients_rate_tier_check;
alter table public.clients add constraint clients_rate_tier_check
  check (rate_tier in ('platinum', 'gold', 'silver'));

alter table public.quotes
  add column if not exists rate_tier       text,
  add column if not exists tariff_sheet_id uuid references public.tariff_sheets (id) on delete set null;

notify pgrst, 'reload schema';
