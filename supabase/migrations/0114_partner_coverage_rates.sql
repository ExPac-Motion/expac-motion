-- ============================================================
-- 0114  Agents / Transporters / Clearing Agents: coverage + rate structures
-- ============================================================
-- Coverage: which modes a partner handles and which countries / ports /
-- airports they service, so the team gets a broad view of what each one
-- does. Rate structures: the partner's rate sheet (e.g. an agent's China ->
-- JNB air freight structure), stored as editable blocks:
--
--   blocks = [{
--     id, commodity, carrier, depart_from, routing, transit, terms, notes,
--     breaks:  [{ label: "0-45KG", rate: 6.589 }],          -- per-kg freight
--     charges: [{ description, amount, basis }],            -- export/terminal
--     pickup:  [{ label: "1-299kg", amount: 45 }]           -- pick-up tiers
--   }, ...]
--
-- Run in the Supabase SQL editor after 0113. Self-contained & idempotent.

do $$
declare
  t text;
begin
  foreach t in array array['agents', 'transporters', 'clearing_agents']
  loop
    execute format(
      'alter table public.%I
         add column if not exists modes          text[] not null default ''{}'',
         add column if not exists countries      text[] not null default ''{}'',
         add column if not exists ports          text[] not null default ''{}'',
         add column if not exists coverage_notes text;', t);
  end loop;
end;
$$;

create table if not exists public.partner_rate_structures (
  id           uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent')),
  partner_id   uuid not null,
  title        text not null,
  mode         text,
  origin       text,               -- e.g. "China / Hong Kong"
  destination  text,               -- e.g. "JNB / DUR / CPT"
  currency     text not null default 'USD',
  valid_from   date,
  valid_until  date,
  notes        text,
  blocks       jsonb not null default '[]'::jsonb,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists partner_rate_structures_partner_idx
  on public.partner_rate_structures (partner_kind, partner_id);

alter table public.partner_rate_structures enable row level security;
drop policy if exists "team full access" on public.partner_rate_structures;
create policy "team full access" on public.partner_rate_structures
  for all to authenticated using (true) with check (true);

-- Remove a partner's rate structures when the partner is deleted
-- (partner_id is polymorphic, so no foreign key can do it).
create or replace function public.delete_partner_rate_structures()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.partner_rate_structures
   where partner_kind = tg_argv[0] and partner_id = old.id;
  return old;
end;
$$;

drop trigger if exists trg_agents_rate_structures on public.agents;
create trigger trg_agents_rate_structures after delete on public.agents
  for each row execute function public.delete_partner_rate_structures('agent');

drop trigger if exists trg_transporters_rate_structures on public.transporters;
create trigger trg_transporters_rate_structures after delete on public.transporters
  for each row execute function public.delete_partner_rate_structures('transporter');

drop trigger if exists trg_clearing_agents_rate_structures on public.clearing_agents;
create trigger trg_clearing_agents_rate_structures after delete on public.clearing_agents
  for each row execute function public.delete_partner_rate_structures('clearing_agent');
