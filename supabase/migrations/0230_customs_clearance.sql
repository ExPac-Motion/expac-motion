-- ============================================================
-- 0230  Customs: clearance files for air and sea shipments (Phase 1)
-- ============================================================
-- A customs file opens by itself when an air or sea shipment reaches
-- In Transit (or Arrived / Unloaded / Customs / Detained), one per shipment
-- that is cleared on its own documents:
--   * a direct shipment;
--   * a master cleared as one (clearance_basis 'master');
--   * each house of a master cleared house by house ('house').
-- The file is assigned to the clearing agent on the shipment's quote
-- (quotes.clearing_agent_id; or the default one
-- in company_settings.customs_default_agent_id) and moves through
--   docs_pending -> ready -> handed_over -> lodged -> query -> cleared.
-- docs_pending / ready follow the shipment's Document Vault: ready once the
-- required documents are there (commercial invoice, packing list, B/L or
-- AWB by default; extra document types can be added per file).
-- The file closes when the shipment is Released / On-Delivery / Delivered
-- (marked cleared if it wasn't) or completed, and reopens if it goes back.
-- Every step is kept in customs_events (who, when), for the SLA reports.
--
-- Access: admin, or staff with the "customs" permission.
--
-- Run in the Supabase SQL editor after 0229. Self-contained & idempotent.

-- ---------- 1. Settings ----------
alter table public.company_settings
  add column if not exists customs_default_agent_id uuid references public.clearing_agents (id) on delete set null;

create or replace function public.can_use_customs()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and public.has_perm('customs'));
$$;
grant execute on function public.can_use_customs() to authenticated;

-- ---------- 2. Tables ----------
create table if not exists public.customs_files (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null unique references public.jobs (id) on delete cascade,
  clearing_agent_id uuid references public.clearing_agents (id) on delete set null,
  stage             text not null default 'docs_pending'
                    check (stage in ('docs_pending', 'ready', 'handed_over', 'lodged', 'query', 'cleared')),
  -- 'ci' commercial invoice, 'pl' packing list, 'tdoc' B/L or AWB; any other
  -- entry is a Document Vault type label ("Certificate of Origin", ...).
  required_docs     text[] not null default '{ci,pl,tdoc}',
  entry_no          text,
  query_note        text,
  notes             text,
  handover_to       text,
  handed_over_at    timestamptz,
  handed_over_by    uuid references auth.users (id) on delete set null,
  lodged_at         timestamptz,
  query_at          timestamptz,
  cleared_at        timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists customs_files_open_idx on public.customs_files (stage) where closed_at is null;

create table if not exists public.customs_events (
  id       uuid primary key default gen_random_uuid(),
  file_id  uuid not null references public.customs_files (id) on delete cascade,
  at       timestamptz not null default now(),
  by       uuid references auth.users (id) on delete set null default auth.uid(),
  kind     text not null check (kind in ('opened', 'stage', 'handover', 'note', 'agent', 'docs', 'closed', 'reopened')),
  stage    text,
  note     text
);
create index if not exists customs_events_file_idx on public.customs_events (file_id, at);

alter table public.customs_files enable row level security;
alter table public.customs_events enable row level security;
drop policy if exists "customs read" on public.customs_files;
drop policy if exists "customs update" on public.customs_files;
create policy "customs read" on public.customs_files for select to authenticated using (public.can_use_customs());
create policy "customs update" on public.customs_files for update to authenticated
  using (public.can_use_customs()) with check (public.can_use_customs());
drop policy if exists "customs events read" on public.customs_events;
drop policy if exists "customs events add" on public.customs_events;
create policy "customs events read" on public.customs_events for select to authenticated using (public.can_use_customs());
-- Notes and handovers from the app; stage / agent events come from the trigger.
create policy "customs events add" on public.customs_events for insert to authenticated
  with check (public.can_use_customs() and kind in ('note', 'handover') and by = auth.uid());
revoke insert, delete on public.customs_files from anon, authenticated;
revoke update, delete on public.customs_events from anon, authenticated;
revoke update on public.customs_files from authenticated;
grant select on public.customs_files to authenticated;
-- Only the working fields; job, timestamps and closed_at are kept by the triggers.
grant update (clearing_agent_id, stage, required_docs, entry_no, query_note, notes, handover_to)
  on public.customs_files to authenticated;
grant select, insert on public.customs_events to authenticated;

-- ---------- 3. Which shipments get a file ----------
-- The shipment's clearing agent lives on its quote (0013); else the default.
create or replace function public.customs_agent_for(p_quote uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select q.clearing_agent_id from public.quotes q where q.id = p_quote),
    (select customs_default_agent_id from public.company_settings where id = 1));
$$;

create or replace function public.customs_eligible(j public.jobs)
returns boolean language sql stable security definer set search_path = public as $$
  select (j.mode like 'Air%' or j.mode like 'Sea%')
     and btrim(coalesce(j.shipment_status, '')) in ('In Transit', 'Arrived', 'Unloaded', 'Customs', 'Detained')
     and j.ops_completed_at is null
     and not (coalesce(j.shipment_kind, 'direct') = 'master' and j.clearance_basis = 'house')
     and not (coalesce(j.shipment_kind, 'direct') = 'house' and exists (
       select 1 from public.jobs m where m.id = j.master_job_id and m.clearance_basis = 'master'));
$$;

-- Past customs: the file closes (and counts as cleared).
create or replace function public.customs_past(j public.jobs)
returns boolean language sql immutable as $$
  select btrim(coalesce(j.shipment_status, '')) in ('Released', 'On-Delivery', 'Delivered');
$$;

-- Required documents not yet in the Document Vault (the shipment's own, and
-- its master's for a house).
create or replace function public.customs_docs_missing(p_file uuid)
returns text[] language sql stable security definer set search_path = public as $$
  with f as (
    select cf.required_docs, j.id as job_id, j.master_job_id
      from public.customs_files cf join public.jobs j on j.id = cf.job_id
     where cf.id = p_file
  ), d as (
    select lower(btrim(sd.doc_type)) as t
      from public.shipment_documents sd, f
     where sd.job_id in (f.job_id, f.master_job_id) and sd.doc_type is not null
  )
  select coalesce(array_agg(r order by ord), '{}')
    from f, unnest(f.required_docs) with ordinality as x(r, ord)
   where not exists (
     select 1 from d where
       case r
         when 'ci' then d.t = 'commercial invoice'
         when 'pl' then d.t = 'packing list'
         when 'tdoc' then d.t in ('bill of lading / awb', 'hawb', 'hbl', 'mawb', 'mbl', 'bill of lading', 'awb')
         else d.t = lower(btrim(r))
       end);
$$;
grant execute on function public.customs_docs_missing(uuid) to authenticated;

-- docs_pending <-> ready, from the documents (later stages are left alone).
create or replace function public.customs_refresh(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  missing text[] := public.customs_docs_missing(p_file);
begin
  update public.customs_files
     set stage = case when cardinality(missing) = 0 then 'ready' else 'docs_pending' end
   where id = p_file and stage in ('docs_pending', 'ready')
     and stage is distinct from (case when cardinality(missing) = 0 then 'ready' else 'docs_pending' end);
end;
$$;

-- ---------- 4. Shipment changes open / close files ----------
create or replace function public.customs_on_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f public.customs_files%rowtype;
  agent uuid;
begin
  select * into f from public.customs_files where job_id = new.id;
  if public.customs_eligible(new) then
    if f.id is null then
      agent := public.customs_agent_for(new.quote_id);
      insert into public.customs_files (job_id, clearing_agent_id) values (new.id, agent) returning * into f;
      insert into public.customs_events (file_id, kind, stage, note, by)
        values (f.id, 'opened', 'docs_pending', 'Shipment ' || btrim(new.shipment_status), auth.uid());
      perform public.customs_refresh(f.id);
    elsif f.closed_at is not null then
      update public.customs_files set closed_at = null where id = f.id;
      insert into public.customs_events (file_id, kind, note, by)
        values (f.id, 'reopened', 'Shipment back to ' || btrim(new.shipment_status), auth.uid());
    end if;
  elsif f.id is not null and f.closed_at is null and (public.customs_past(new) or new.ops_completed_at is not null) then
    if public.customs_past(new) and f.stage <> 'cleared' then
      update public.customs_files set stage = 'cleared' where id = f.id;
    end if;
    update public.customs_files set closed_at = now() where id = f.id;
    insert into public.customs_events (file_id, kind, note, by)
      values (f.id, 'closed', case when new.ops_completed_at is not null and not public.customs_past(new)
                                   then 'Shipment completed' else 'Shipment ' || btrim(new.shipment_status) end, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists trg_customs_on_job on public.jobs;
create trigger trg_customs_on_job
  after insert or update of shipment_status, mode, ops_completed_at, clearance_basis
  on public.jobs for each row execute function public.customs_on_job();

-- ---------- 5. Stage timestamps + history ----------
create or replace function public.customs_on_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.stage is distinct from old.stage then
    case new.stage
      when 'handed_over' then
        new.handed_over_at := coalesce(new.handed_over_at, now());
        new.handed_over_by := coalesce(new.handed_over_by, auth.uid());
      when 'lodged' then new.lodged_at := coalesce(new.lodged_at, now());
      when 'query' then new.query_at := now();
      when 'cleared' then new.cleared_at := now();
      else null;
    end case;
    if old.stage = 'cleared' then new.cleared_at := null; end if;
    insert into public.customs_events (file_id, kind, stage, note, by)
      values (new.id, 'stage', new.stage, old.stage || ' -> ' || new.stage, auth.uid());
  end if;
  if new.clearing_agent_id is distinct from old.clearing_agent_id then
    insert into public.customs_events (file_id, kind, note, by)
      values (new.id, 'agent', coalesce((select company from public.clearing_agents where id = new.clearing_agent_id), 'No agent'), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customs_on_file on public.customs_files;
create trigger trg_customs_on_file before update on public.customs_files
  for each row execute function public.customs_on_file();

-- Required documents changed on the file: re-check ready / docs pending.
create or replace function public.customs_on_required()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.customs_refresh(new.id);
  return null;
end;
$$;
drop trigger if exists trg_customs_on_required on public.customs_files;
create trigger trg_customs_on_required after update of required_docs on public.customs_files
  for each row execute function public.customs_on_required();

-- ---------- 6. Document Vault changes re-check the files ----------
create or replace function public.customs_on_document()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j uuid := coalesce(new.job_id, old.job_id);
  fid uuid;
begin
  for fid in
    select cf.id from public.customs_files cf join public.jobs x on x.id = cf.job_id
     where cf.closed_at is null and (x.id = j or x.master_job_id = j)
  loop
    perform public.customs_refresh(fid);
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_customs_on_document on public.shipment_documents;
create trigger trg_customs_on_document
  after insert or delete or update of doc_type, job_id on public.shipment_documents
  for each row execute function public.customs_on_document();

revoke all on function public.customs_eligible(public.jobs) from public, anon, authenticated;
revoke all on function public.customs_refresh(uuid) from public, anon, authenticated;
revoke all on function public.customs_on_job() from public, anon, authenticated;
revoke all on function public.customs_on_file() from public, anon, authenticated;
revoke all on function public.customs_on_required() from public, anon, authenticated;
revoke all on function public.customs_on_document() from public, anon, authenticated;

-- A clearing agent picked on the quote later fills its shipments' open,
-- unassigned files.
create or replace function public.customs_on_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.clearing_agent_id is not null then
    update public.customs_files cf set clearing_agent_id = new.clearing_agent_id
      from public.jobs j
     where j.id = cf.job_id and j.quote_id = new.id
       and cf.clearing_agent_id is null and cf.closed_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_customs_on_quote on public.quotes;
create trigger trg_customs_on_quote after update of clearing_agent_id on public.quotes
  for each row execute function public.customs_on_quote();
revoke all on function public.customs_on_quote() from public, anon, authenticated;
revoke all on function public.customs_agent_for(uuid) from public, anon, authenticated;

-- ---------- 7. Shipments already in transit ----------
do $$
declare
  j public.jobs%rowtype;
  fid uuid;
begin
  for j in select * from public.jobs x where public.customs_eligible(x)
             and not exists (select 1 from public.customs_files cf where cf.job_id = x.id)
  loop
    insert into public.customs_files (job_id, clearing_agent_id)
      values (j.id, public.customs_agent_for(j.quote_id))
      returning id into fid;
    insert into public.customs_events (file_id, kind, stage, note, by)
      values (fid, 'opened', 'docs_pending', 'Shipment ' || btrim(j.shipment_status), null);
    perform public.customs_refresh(fid);
  end loop;
end;
$$;

-- ---------- 8. Live updates ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.customs_files;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
