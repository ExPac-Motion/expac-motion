-- ============================================================
-- 0124  Destination Handling Agents + FOB / Cartage & Road Freight sections
-- ============================================================
-- 1. New partner type: Destination Handling Agents (their own list, rate
--    sheets, partner-portal logins, tier-sheet link, quote field) — set up
--    exactly like transporters.
-- 2. Two new charge sections on quotes: 'FOB Charges' (FB-01 Release Fee,
--    FB-02 Bill of Lading Fee) and 'Cartage and Road Freight Charges'
--    (TR-01 / TR-02 move here from Destination Handling). Warehousing is
--    codes only (WH-01..03), not a section.
--
-- Partner sections (app side): shipping agents = International Freight,
-- Ex-Works, FOB (+ warehousing codes); destination agents = Destination
-- Handling; transporters = Cartage & Road Freight (+ warehousing codes);
-- clearing agents = Customs.
--
-- Run in the Supabase SQL editor after 0123. Self-contained & idempotent.

-- ---------- 1. Destination agents ----------
create table if not exists public.destination_agents (like public.transporters including all);

alter table public.destination_agents enable row level security;
drop policy if exists "team full access" on public.destination_agents;
create policy "team full access" on public.destination_agents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Partner kind now includes destination_agent everywhere it is checked.
alter table public.partner_rate_sheets drop constraint if exists partner_rate_sheets_partner_kind_check;
alter table public.partner_rate_sheets add constraint partner_rate_sheets_partner_kind_check
  check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent'));
alter table public.partner_invites drop constraint if exists partner_invites_partner_kind_check;
alter table public.partner_invites add constraint partner_invites_partner_kind_check
  check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent'));
alter table public.profiles drop constraint if exists profiles_partner_kind_check;
alter table public.profiles add constraint profiles_partner_kind_check
  check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent'));

drop trigger if exists trg_destination_agents_rate_sheets on public.destination_agents;
create trigger trg_destination_agents_rate_sheets after delete on public.destination_agents
  for each row execute function public.delete_partner_rate_sheets('destination_agent');

create or replace function public.partner_company(p_kind text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_kind
    when 'agent' then (select a.company from public.agents a where a.id = p_id)
    when 'transporter' then (select t.company from public.transporters t where t.id = p_id)
    when 'clearing_agent' then (select c.company from public.clearing_agents c where c.id = p_id)
    when 'destination_agent' then (select d.company from public.destination_agents d where d.id = p_id)
  end;
$$;

create or replace function public.my_partner()
returns table (partner_kind text, partner_id uuid, company text)
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
begin
  if k is null or p is null then
    return;
  end if;
  return query select k, p, public.partner_company(k, p);
end;
$$;

create or replace function public.get_partner_invite(p_token uuid)
returns table (email text, company text, partner_kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select i.email, public.partner_company(i.partner_kind, i.partner_id), i.partner_kind
    from public.partner_invites i
    where i.token = p_token and i.claimed_at is null;
end;
$$;
grant execute on function public.get_partner_invite(uuid) to anon, authenticated;

-- Tier sheets + quotes carry a destination agent like the other partners.
alter table public.tariff_sheets
  add column if not exists destination_agent_id uuid
    references public.destination_agents (id) on delete set null,
  add column if not exists destination_agent_sheet_id uuid
    references public.partner_rate_sheets (id) on delete set null;
alter table public.quotes
  add column if not exists destination_agent_id uuid
    references public.destination_agents (id) on delete set null;

-- ---------- 2. Charge sections ----------
alter table public.quote_lines drop constraint if exists quote_lines_category_check;
alter table public.quote_lines add constraint quote_lines_category_check check (category in (
  'International Freight Charges',
  'Ex-Works Charges',
  'FOB Charges',
  'Destination Handling and Delivery Charges',
  'Cartage and Road Freight Charges',
  'Customs Clearance, VAT and Duty Charges'
));

notify pgrst, 'reload schema';
