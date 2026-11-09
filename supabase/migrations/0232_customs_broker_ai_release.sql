-- ============================================================
-- 0232  Customs, Phases 2-4: Broker Desk, Motion AI document data,
--       release after clearance + agent performance
-- ============================================================
-- Phase 2, Broker Desk. A clearing agent's partner login (0121, partner_kind
-- 'clearing_agent') sees the customs files handed over to that agent, and
-- nothing else:
--   * broker_files(): its files, with the shipment details it needs to
--     clear (reference, importer + VAT / customs code, AWB / B/L, vessel,
--     ETA, ...), the documents, Motion AI's extracted data and the history;
--   * it can open those documents (storage rule below), upload customs
--     documents (release note, entry, duty invoice) into
--     shipment-documents/broker/<file id>/..., mark Entry lodged / Query
--     raised / Customs cleared and leave notes (broker_update);
--   * each step it takes opens a Control Tower task for ExPac.
--   Marking Customs cleared also sets the shipment to Released, so the
--   customer's portal and tracking move on (and the file closes).
-- Phase 3, Motion AI: customs_files.extraction holds the data read from
--   the documents (invoice, packing list, B/L / AWB), checked by ExPac.
-- Phase 4: release_sent_at / release_sent_to (the release note sent to the
--   transporter) and delivery_note_at (delivery note issued) on the file.
--
-- Run in the Supabase SQL editor after 0231. Self-contained & idempotent.

-- ---------- 1. Columns ----------
alter table public.customs_files add column if not exists extraction jsonb;
alter table public.customs_files add column if not exists extracted_at timestamptz;
alter table public.customs_files add column if not exists extracted_by uuid references auth.users (id) on delete set null;
alter table public.customs_files add column if not exists release_sent_at timestamptz;
alter table public.customs_files add column if not exists release_sent_to text;
alter table public.customs_files add column if not exists delivery_note_at timestamptz;
alter table public.shipment_documents add column if not exists from_broker boolean not null default false;

alter table public.customs_events drop constraint if exists customs_events_kind_check;
alter table public.customs_events add constraint customs_events_kind_check
  check (kind in ('opened', 'stage', 'handover', 'note', 'agent', 'docs', 'closed', 'reopened', 'anf', 'extract', 'release'));

revoke update on public.customs_files from authenticated;
grant update (clearing_agent_id, stage, required_docs, entry_no, query_note, notes, handover_to, anf_at, anf_source,
              extraction, release_sent_at, release_sent_to, delivery_note_at)
  on public.customs_files to authenticated;

-- ---------- 2. History for the new fields ----------
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
  if new.anf_at is distinct from old.anf_at then
    if new.anf_at is null then new.anf_source := null; end if;
    insert into public.customs_events (file_id, kind, note, by)
      values (new.id, 'anf',
              case when new.anf_at is null then 'ANF removed'
                   else 'ANF received' || coalesce(' (' || nullif(btrim(new.anf_source), '') || ')', '') end,
              auth.uid());
  end if;
  if new.extraction is distinct from old.extraction then
    new.extracted_at := case when new.extraction is null then null else now() end;
    new.extracted_by := case when new.extraction is null then null else auth.uid() end;
    insert into public.customs_events (file_id, kind, note, by)
      values (new.id, 'extract',
              case when new.extraction is null then 'Document data removed'
                   when old.extraction is null then 'Document data saved (Motion AI)'
                   else 'Document data edited' end,
              auth.uid());
  end if;
  if new.release_sent_at is distinct from old.release_sent_at and new.release_sent_at is not null then
    insert into public.customs_events (file_id, kind, note, by)
      values (new.id, 'release', 'Release sent to the transporter' || coalesce(' (' || nullif(btrim(new.release_sent_to), '') || ')', ''), auth.uid());
  end if;
  if new.delivery_note_at is distinct from old.delivery_note_at and new.delivery_note_at is not null then
    insert into public.customs_events (file_id, kind, note, by)
      values (new.id, 'release', 'Delivery note issued', auth.uid());
  end if;
  return new;
end;
$$;

-- ---------- 3. Broker Desk: who, and which files ----------
create or replace function public.broker_agent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.my_partner_kind() = 'clearing_agent' then public.my_partner_id() end;
$$;
grant execute on function public.broker_agent_id() to authenticated;

-- A file handed over to the signed-in clearing agent (text in: a bad
-- storage folder name is just "no").
create or replace function public.broker_owns_file(p_file text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if public.broker_agent_id() is null or p_file is null or p_file !~* '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (
    select 1 from public.customs_files
     where id = p_file::uuid and clearing_agent_id = public.broker_agent_id() and handed_over_at is not null);
end;
$$;
grant execute on function public.broker_owns_file(text) to authenticated;

-- A stored document of one of the agent's files (the shipment's own, or
-- its master's for a house).
create or replace function public.broker_can_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.broker_agent_id() is not null and exists (
    select 1
      from public.shipment_documents sd
      join public.customs_files cf on cf.clearing_agent_id = public.broker_agent_id() and cf.handed_over_at is not null
      join public.jobs j on j.id = cf.job_id
     where sd.storage_path = p_path
       and (sd.job_id = cf.job_id or sd.job_id = j.master_job_id));
$$;
grant execute on function public.broker_can_open(text) to authenticated;

drop policy if exists "brokers open customs documents" on storage.objects;
create policy "brokers open customs documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'shipment-documents' and public.broker_can_open(name));

drop policy if exists "brokers upload customs documents" on storage.objects;
create policy "brokers upload customs documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and (storage.foldername(name))[1] = 'broker'
    and public.broker_owns_file((storage.foldername(name))[2]));

-- ---------- 4. Broker Desk: the agent's files ----------
create or replace function public.broker_files()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'sort'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', cf.id,
      'sort', case when cf.closed_at is null and cf.stage <> 'cleared' then '0' else '1' end || coalesce(j.eta::text, '9999'),
      'stage', cf.stage, 'entry_no', cf.entry_no, 'query_note', cf.query_note,
      'handed_over_at', cf.handed_over_at, 'lodged_at', cf.lodged_at, 'query_at', cf.query_at,
      'cleared_at', cf.cleared_at, 'closed_at', cf.closed_at, 'anf_at', cf.anf_at,
      'extraction', cf.extraction,
      'reference', j.reference, 'mode', j.mode, 'shipment_status', j.shipment_status,
      'awb_mbl', j.awb_mbl, 'container_no', j.container_no, 'vessel_name', j.vessel_name,
      'carrier_name', j.carrier_name, 'eta', j.eta, 'etd', j.etd,
      'origin', j.origin, 'destination', j.destination, 'po_no', j.po_no,
      'importer', jsonb_build_object('company', c.company, 'vat_no', c.vat_no, 'import_code', c.import_code,
                                     'address', c.address, 'contact', c.contact, 'email', c.email, 'phone', c.phone),
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'doc_type', d.doc_type,
                                            'storage_path', d.storage_path, 'size_bytes', d.size_bytes,
                                            'created_at', d.created_at, 'from_broker', d.from_broker)
                         order by d.created_at)
          from public.shipment_documents d
         where d.job_id in (j.id, j.master_job_id)), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'stage', e.stage, 'note', e.note,
                                            'mine', e.by = auth.uid())
                         order by e.at desc)
          from public.customs_events e
         where e.file_id = cf.id and e.kind in ('handover', 'stage', 'note', 'docs', 'anf')), '[]'::jsonb)
    ) as x
    from public.customs_files cf
    join public.jobs j on j.id = cf.job_id
    left join public.clients c on c.id = j.client_id
    where cf.clearing_agent_id = public.broker_agent_id()
      and cf.handed_over_at is not null
      and (cf.closed_at is null or cf.closed_at > now() - interval '30 days')
  ) s;
$$;
grant execute on function public.broker_files() to authenticated;

-- A Control Tower task for ExPac about one of the agent's steps.
create or replace function public.customs_task_for_expac(p_file uuid, p_title text, p_body text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
begin
  select x.* into j from public.jobs x join public.customs_files cf on cf.job_id = x.id where cf.id = p_file;
  insert into public.ops_tasks (kind, title, body, status, priority, job_id, client_id, created_by)
  values ('task', p_title || ' – ' || coalesce(j.reference, ''), p_body, 'open', p_priority, j.id, j.client_id, auth.uid());
end;
$$;

-- Entry lodged / Query raised / Customs cleared, the entry number and a
-- note, from the agent.
create or replace function public.broker_update(p_file uuid, p_stage text default null, p_entry_no text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.customs_files%rowtype;
  agent text;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.broker_owns_file(p_file::text) then
    raise exception 'This customs file is not yours';
  end if;
  select * into f from public.customs_files where id = p_file;
  if f.closed_at is not null then
    raise exception 'This file is closed';
  end if;
  if p_stage is not null and p_stage not in ('lodged', 'query', 'cleared') then
    raise exception 'Mark Entry lodged, Query raised or Customs cleared';
  end if;
  if p_stage = 'query' and note is null then
    raise exception 'Say what the query is about';
  end if;
  select company into agent from public.clearing_agents where id = f.clearing_agent_id;

  update public.customs_files
     set stage = coalesce(p_stage, stage),
         entry_no = coalesce(nullif(btrim(coalesce(p_entry_no, '')), ''), entry_no),
         query_note = case when p_stage = 'query' then note else query_note end
   where id = p_file;
  if note is not null then
    insert into public.customs_events (file_id, kind, note, by)
      values (p_file, 'note', coalesce(agent, 'Clearing agent') || ': ' || note, auth.uid());
  end if;

  if p_stage = 'lodged' then
    perform public.customs_task_for_expac(p_file, 'Customs entry lodged',
      coalesce(agent, 'The clearing agent') || ' lodged the entry' || coalesce(' ' || nullif(btrim(coalesce(p_entry_no, '')), ''), '') || '.', 'low');
  elsif p_stage = 'query' then
    perform public.customs_task_for_expac(p_file, 'Customs query', coalesce(agent, 'The clearing agent') || ': ' || note, 'high');
  elsif p_stage = 'cleared' then
    -- The shipment moves on (portal + tracking); the file closes.
    update public.jobs set shipment_status = 'Released'
     where id = f.job_id and btrim(coalesce(shipment_status, '')) not in ('Released', 'On-Delivery', 'Delivered');
    perform public.customs_task_for_expac(p_file, 'Customs cleared: send the release',
      coalesce(agent, 'The clearing agent') || ' cleared the shipment. Send the release note to the transporter and issue the delivery note (Customs › the file).', 'high');
  elsif note is not null then
    perform public.customs_task_for_expac(p_file, 'Note from the clearing agent', note, 'normal');
  end if;
end;
$$;
grant execute on function public.broker_update(uuid, text, text, text) to authenticated;

-- A customs document from the agent (uploaded to broker/<file id>/ first).
create or replace function public.broker_add_document(p_file uuid, p_name text, p_path text, p_doc_type text, p_size bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  f public.customs_files%rowtype;
  v_id uuid;
begin
  if not public.broker_owns_file(p_file::text) then
    raise exception 'This customs file is not yours';
  end if;
  if p_doc_type not in ('Customs Release Note', 'Customs Entry', 'Duty / VAT Invoice', 'Customs', 'Other') then
    raise exception 'Upload a release note, customs entry, duty / VAT invoice or other customs document';
  end if;
  if p_path is null or p_path not like 'broker/' || p_file::text || '/%' then
    raise exception 'Upload the file to this customs file first';
  end if;
  select * into f from public.customs_files where id = p_file;
  insert into public.shipment_documents (job_id, name, storage_path, kind, doc_type, size_bytes, visible_to_client, from_broker)
  values (f.job_id, coalesce(nullif(btrim(p_name), ''), 'Document'), p_path, 'upload', p_doc_type, p_size, false, true)
  returning id into v_id;
  insert into public.customs_events (file_id, kind, note, by)
    values (p_file, 'docs', 'Clearing agent uploaded ' || p_doc_type || ': ' || coalesce(p_name, ''), auth.uid());
  perform public.customs_task_for_expac(p_file, 'Clearing agent uploaded ' || p_doc_type, 'File: ' || coalesce(p_name, '') || '.',
    case when p_doc_type = 'Customs Release Note' then 'high' else 'normal' end);
  return v_id;
end;
$$;
grant execute on function public.broker_add_document(uuid, text, text, text, bigint) to authenticated;

-- ---------- 5. Agent performance (staff) ----------
-- Files handed over in the last p_days days, with how many queries each had.
create or replace function public.customs_agent_stats(p_days integer default 180)
returns table (file_id uuid, clearing_agent_id uuid, stage text, handed_over_at timestamptz, lodged_at timestamptz,
               cleared_at timestamptz, closed_at timestamptz, queries integer)
language sql stable security definer set search_path = public as $$
  select cf.id, cf.clearing_agent_id, cf.stage, cf.handed_over_at, cf.lodged_at, cf.cleared_at, cf.closed_at,
         (select count(*)::int from public.customs_events e where e.file_id = cf.id and e.kind = 'stage' and e.stage = 'query')
    from public.customs_files cf
   where public.can_use_customs()
     and cf.handed_over_at > now() - make_interval(days => greatest(1, least(p_days, 730)));
$$;
grant execute on function public.customs_agent_stats(integer) to authenticated;

revoke all on function public.customs_task_for_expac(uuid, text, text, text) from public, anon, authenticated;
