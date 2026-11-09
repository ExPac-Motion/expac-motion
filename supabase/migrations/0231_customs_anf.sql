-- ============================================================
-- 0231  Customs: carrier arrival notifications (ANF) on customs files
-- ============================================================
-- A customs file records when the carrier's arrival notification (ANF)
-- came in, so a shipment with an ANF that hasn't been handed over to the
-- clearing agent stands out on the board. It's marked by itself when:
--   * a document of type "Arrival Notification (ANF)" is added to the
--     shipment's Document Vault (or its master's, for a house); or
--   * an incoming email that reads like an arrival notice ("Arrival
--     Notice", "Notice of Arrival", "ANF", "Cargo Arrival", ...) is linked
--     to the shipment in the Inbox (automatically or by hand).
-- It can also be marked by hand on the file. Each mark is in the history.
--
-- Run in the Supabase SQL editor after 0230. Self-contained & idempotent.

alter table public.customs_files add column if not exists anf_at timestamptz;
alter table public.customs_files add column if not exists anf_source text;

alter table public.customs_events drop constraint if exists customs_events_kind_check;
alter table public.customs_events add constraint customs_events_kind_check
  check (kind in ('opened', 'stage', 'handover', 'note', 'agent', 'docs', 'closed', 'reopened', 'anf'));

-- Logins may also set / clear the ANF by hand.
revoke update on public.customs_files from authenticated;
grant update (clearing_agent_id, stage, required_docs, entry_no, query_note, notes, handover_to, anf_at, anf_source)
  on public.customs_files to authenticated;

-- ---------- 1. History: ANF marked / cleared ----------
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
  return new;
end;
$$;

-- ---------- 2. Mark the open files of a shipment (and its houses) ----------
create or replace function public.customs_mark_anf(p_job uuid, p_source text, p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.customs_files cf
     set anf_at = coalesce(p_at, now()), anf_source = left(p_source, 200)
    from public.jobs j
   where j.id = cf.job_id and (j.id = p_job or j.master_job_id = p_job)
     and cf.closed_at is null and cf.anf_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.customs_is_anf_doc(t text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(t, ''))) in ('arrival notification (anf)', 'arrival notification', 'arrival notice', 'anf');
$$;

create or replace function public.customs_is_anf_subject(s text)
returns boolean language sql immutable as $$
  select coalesce(s, '') ~* '(arrival\s+notice|arrival\s+notification|notice\s+of\s+arrival|arrival\s+advice|cargo\s+arrival|pre-?\s?arrival|\yANF\y|\yA/N\y)';
$$;

-- ---------- 3. Documents: an ANF document marks the file ----------
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
  if tg_op <> 'DELETE' and public.customs_is_anf_doc(new.doc_type)
     and (tg_op = 'INSERT' or not public.customs_is_anf_doc(old.doc_type)) then
    perform public.customs_mark_anf(new.job_id, 'Document: ' || coalesce(new.name, 'ANF'), new.created_at);
  end if;
  return null;
end;
$$;

-- ---------- 4. Inbox: an arrival notice linked to the shipment marks it ----------
create or replace function public.customs_on_inbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_id is not null and new.direction = 'in' and public.customs_is_anf_subject(new.subject)
     and (tg_op = 'INSERT' or new.job_id is distinct from old.job_id) then
    perform public.customs_mark_anf(new.job_id, 'Email: ' || coalesce(new.from_email, '') || ' – ' || coalesce(new.subject, ''),
                                    coalesce(new.sent_at, now()));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_customs_on_inbox on public.inbox_messages;
create trigger trg_customs_on_inbox after insert or update of job_id on public.inbox_messages
  for each row execute function public.customs_on_inbox();

-- A file opened after the ANF email / document arrived picks it up too.
create or replace function public.customs_anf_backfill(p_file uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  jid uuid;
  mid uuid;
  src text;
  at timestamptz;
begin
  select j.id, j.master_job_id into jid, mid
    from public.customs_files cf join public.jobs j on j.id = cf.job_id
   where cf.id = p_file and cf.anf_at is null;
  if jid is null then return; end if;
  select 'Email: ' || coalesce(m.from_email, '') || ' – ' || coalesce(m.subject, ''), coalesce(m.sent_at, m.created_at)
    into src, at
    from public.inbox_messages m
   where m.job_id in (jid, mid) and m.direction = 'in' and public.customs_is_anf_subject(m.subject)
   order by coalesce(m.sent_at, m.created_at) limit 1;
  if src is null then
    select 'Document: ' || d.name, d.created_at into src, at
      from public.shipment_documents d
     where d.job_id in (jid, mid) and public.customs_is_anf_doc(d.doc_type)
     order by d.created_at limit 1;
  end if;
  if src is not null then
    update public.customs_files set anf_at = at, anf_source = left(src, 200) where id = p_file;
  end if;
end;
$$;

create or replace function public.customs_on_file_open()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.customs_anf_backfill(new.id);
  return null;
end;
$$;
drop trigger if exists trg_customs_on_file_open on public.customs_files;
create trigger trg_customs_on_file_open after insert on public.customs_files
  for each row execute function public.customs_on_file_open();

revoke all on function public.customs_mark_anf(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.customs_on_inbox() from public, anon, authenticated;
revoke all on function public.customs_anf_backfill(uuid) from public, anon, authenticated;
revoke all on function public.customs_on_file_open() from public, anon, authenticated;

-- ---------- 5. Files already open ----------
do $$
declare
  fid uuid;
begin
  for fid in select id from public.customs_files where closed_at is null and anf_at is null loop
    perform public.customs_anf_backfill(fid);
  end loop;
end;
$$;
