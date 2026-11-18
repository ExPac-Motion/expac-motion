-- ============================================================
-- 0247  Clearing Agent -> Transporter cross-listing + partner contacts
-- ============================================================
-- A clearing agent that also moves the cargo: ticking "Is also
-- Transporter" keeps a mirror row in transporters (kept in sync by
-- trigger, like agents <-> clearing agents in 0014), so it shows in the
-- Transporters contact book and the quote builder's transporter dropdown
-- with a valid id. The mirror is read-only in the UI; it is edited on the
-- clearing agent. Unticking (or deleting the clearing agent) removes it.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

begin;

alter table public.clearing_agents
  add column if not exists also_transporter boolean not null default false;

alter table public.transporters
  add column if not exists source_clearing_agent_id uuid
    references public.clearing_agents (id) on delete cascade;

create unique index if not exists transporters_source_clearing_agent_uk
  on public.transporters (source_clearing_agent_id);

create or replace function public.sync_clearing_to_transporter()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- a clearing agent that is itself a mirror (of an agent) never propagates
  if NEW.source_agent_id is not null then
    return NEW;
  end if;

  if NEW.also_transporter then
    insert into public.transporters
      (company, contact, email, phone, vat_no, import_code, address,
       modes, countries, ports, coverage_notes, source_clearing_agent_id)
    values
      (NEW.company, NEW.contact, NEW.email, NEW.phone, NEW.vat_no,
       NEW.import_code, NEW.address, NEW.modes, NEW.countries, NEW.ports,
       NEW.coverage_notes, NEW.id)
    on conflict (source_clearing_agent_id) do update set
      company        = excluded.company,
      contact        = excluded.contact,
      email          = excluded.email,
      phone          = excluded.phone,
      vat_no         = excluded.vat_no,
      import_code    = excluded.import_code,
      address        = excluded.address,
      modes          = excluded.modes,
      countries      = excluded.countries,
      ports          = excluded.ports,
      coverage_notes = excluded.coverage_notes;
  else
    delete from public.transporters where source_clearing_agent_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_clearing_to_transporter on public.clearing_agents;
create trigger sync_clearing_to_transporter
  after insert or update on public.clearing_agents
  for each row execute function public.sync_clearing_to_transporter();

-- ------------------------------------------------------------
-- Partner contacts: more people per agent / transporter / clearing agent /
-- destination agent (the record's own contact stays the primary), like
-- client_contacts on a customer, plus an address and notes per person.
-- A mirror row shows its master's contacts (kept on the master).
-- ------------------------------------------------------------
create table if not exists public.partner_contacts (
  id           uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id   uuid not null,
  salutation   text,
  name         text not null default '',
  role         text,
  email        text,
  phone        text,
  mobile       text,
  address      text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists partner_contacts_partner_idx on public.partner_contacts (partner_kind, partner_id);

alter table public.partner_contacts enable row level security;
drop policy if exists "team full access" on public.partner_contacts;
create policy "team full access" on public.partner_contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- partner_id points at one of four tables, so no foreign key: a deleted
-- partner takes its contacts with it here.
create or replace function public.partner_contacts_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.partner_contacts where partner_kind = TG_ARGV[0] and partner_id = OLD.id;
  return OLD;
end;
$$;

drop trigger if exists partner_contacts_cleanup on public.agents;
create trigger partner_contacts_cleanup after delete on public.agents
  for each row execute function public.partner_contacts_cleanup('agent');
drop trigger if exists partner_contacts_cleanup on public.transporters;
create trigger partner_contacts_cleanup after delete on public.transporters
  for each row execute function public.partner_contacts_cleanup('transporter');
drop trigger if exists partner_contacts_cleanup on public.clearing_agents;
create trigger partner_contacts_cleanup after delete on public.clearing_agents
  for each row execute function public.partner_contacts_cleanup('clearing_agent');
drop trigger if exists partner_contacts_cleanup on public.destination_agents;
create trigger partner_contacts_cleanup after delete on public.destination_agents
  for each row execute function public.partner_contacts_cleanup('destination_agent');

commit;
notify pgrst, 'reload schema';
