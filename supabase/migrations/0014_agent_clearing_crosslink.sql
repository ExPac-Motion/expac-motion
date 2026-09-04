-- ============================================================
-- 0014  Agent <-> Clearing Agent cross-listing
-- ============================================================
-- A company can be flagged as serving both roles. Ticking the box on
-- one side keeps a mirror row in the other table (kept in sync by
-- trigger), so it shows in that contact book and in the matching quote
-- builder dropdown with a valid id. The mirror row is read-only in the
-- UI; editing happens on the master record.
--
-- Run in the Supabase SQL editor after 0013. Self-contained & idempotent.

alter table public.agents
  add column if not exists also_clearing_agent      boolean not null default false,
  add column if not exists source_clearing_agent_id uuid
    references public.clearing_agents (id) on delete cascade;

alter table public.clearing_agents
  add column if not exists also_agent      boolean not null default false,
  add column if not exists source_agent_id uuid
    references public.agents (id) on delete cascade;

create unique index if not exists clearing_agents_source_agent_uk
  on public.clearing_agents (source_agent_id);
create unique index if not exists agents_source_clearing_agent_uk
  on public.agents (source_clearing_agent_id);

-- agents -> clearing_agents
create or replace function public.sync_agent_to_clearing()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- a mirror row never propagates further
  if NEW.source_clearing_agent_id is not null then
    return NEW;
  end if;

  if NEW.also_clearing_agent then
    insert into public.clearing_agents
      (company, contact, email, phone, vat_no, import_code, address, source_agent_id)
    values
      (NEW.company, NEW.contact, NEW.email, NEW.phone, NEW.vat_no,
       NEW.import_code, NEW.address, NEW.id)
    on conflict (source_agent_id) do update set
      company     = excluded.company,
      contact     = excluded.contact,
      email       = excluded.email,
      phone       = excluded.phone,
      vat_no      = excluded.vat_no,
      import_code = excluded.import_code,
      address     = excluded.address;
  else
    delete from public.clearing_agents where source_agent_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_agent_to_clearing on public.agents;
create trigger sync_agent_to_clearing
  after insert or update on public.agents
  for each row execute function public.sync_agent_to_clearing();

-- clearing_agents -> agents
create or replace function public.sync_clearing_to_agent()
returns trigger
language plpgsql
security invoker
as $$
begin
  if NEW.source_agent_id is not null then
    return NEW;
  end if;

  if NEW.also_agent then
    insert into public.agents
      (company, contact, email, phone, vat_no, import_code, address, source_clearing_agent_id)
    values
      (NEW.company, NEW.contact, NEW.email, NEW.phone, NEW.vat_no,
       NEW.import_code, NEW.address, NEW.id)
    on conflict (source_clearing_agent_id) do update set
      company     = excluded.company,
      contact     = excluded.contact,
      email       = excluded.email,
      phone       = excluded.phone,
      vat_no      = excluded.vat_no,
      import_code = excluded.import_code,
      address     = excluded.address;
  else
    delete from public.agents where source_clearing_agent_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_clearing_to_agent on public.clearing_agents;
create trigger sync_clearing_to_agent
  after insert or update on public.clearing_agents
  for each row execute function public.sync_clearing_to_agent();

-- Backfill mirrors for any rows already flagged.
update public.agents          set also_clearing_agent = also_clearing_agent
  where also_clearing_agent and source_clearing_agent_id is null;
update public.clearing_agents  set also_agent = also_agent
  where also_agent and source_agent_id is null;
