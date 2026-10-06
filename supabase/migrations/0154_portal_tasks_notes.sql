-- 0154: Customer Portal › Tasks & Notes, synced with Motion's Tasks & Notes.
--
-- Portal tasks and notes are ordinary ops_tasks rows (kind 'task' / 'note'),
-- so they show in Motion's Control Tower › Tasks & Notes like any other:
--   * from the customer: from_portal = true (+ portal_visible), linked to one
--     of their shipments, quotations, or just their account (client_id);
--   * from ExPac: any task or note on the customer's shipment, quotation or
--     account with "Show to the customer" ticked (portal_visible).
-- Internal notes stay internal (portal_visible false).
--
-- client_tasks now covers shipments, quotations and the account, and notes;
-- columns are appended (kind, quote_id, client_id, job / quote reference,
-- updated_at). Portal RPCs save, update and delete the customer's own items.
--
-- Run in the Supabase SQL Editor after 0153.

create or replace view public.client_tasks
with (security_barrier = true) as
select t.id, t.job_id, t.title, t.body, t.status, t.due_date, t.created_at, t.done_at, t.from_portal,
       t.kind, t.quote_id, t.client_id,
       j.reference as job_reference,
       q.reference as quote_reference,
       t.updated_at
from public.ops_tasks t
left join public.jobs j on j.id = t.job_id
left join public.quotes q on q.id = t.quote_id
where (t.portal_visible or t.from_portal)
  and t.kind in ('task', 'note')
  and coalesce(j.client_id, q.client_id, t.client_id) = public.my_client_id()
  and (t.job_id is null or j.client_id = public.my_client_id())
  and (t.quote_id is null or q.client_id = public.my_client_id());
grant select on public.client_tasks to authenticated;

-- Customer adds a task or note. p: {kind, title, body, due_date, job_id, quote_id}
create or replace function public.portal_save_item(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  k text := case when p ->> 'kind' = 'note' then 'note' else 'task' end;
  jid uuid := nullif(p ->> 'job_id', '')::uuid;
  qid uuid := nullif(p ->> 'quote_id', '')::uuid;
  tid uuid;
begin
  if cid is null then
    raise exception 'Only a customer portal login can add this';
  end if;
  if jid is not null and not exists (select 1 from public.jobs where id = jid and client_id = cid) then
    raise exception 'Shipment not found';
  end if;
  if qid is not null and not exists (select 1 from public.quotes where id = qid and client_id = cid) then
    raise exception 'Quotation not found';
  end if;
  if coalesce(trim(p ->> 'title'), '') = '' and coalesce(trim(p ->> 'body'), '') = '' then
    raise exception 'Write something first';
  end if;
  insert into public.ops_tasks (kind, title, body, status, priority, due_date, job_id, quote_id, client_id,
                                from_portal, portal_visible, created_by)
  values (k,
          coalesce(nullif(trim(p ->> 'title'), ''), left(trim(p ->> 'body'), 80)),
          nullif(trim(p ->> 'body'), ''),
          'open', 'normal', nullif(p ->> 'due_date', '')::date, jid, qid, cid,
          true, true, auth.uid())
  returning id into tid;
  return tid;
end;
$$;
grant execute on function public.portal_save_item(jsonb) to authenticated;

-- Customer edits its own item: title, body, due date, done / open.
create or replace function public.portal_update_item(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.ops_tasks%rowtype;
begin
  select * into t from public.ops_tasks where id = p_id;
  if not found or not t.from_portal or t.client_id is distinct from public.my_client_id() then
    raise exception 'Not found';
  end if;
  update public.ops_tasks set
    title = case when p ? 'title' then coalesce(nullif(trim(p ->> 'title'), ''), t.title) else t.title end,
    body = case when p ? 'body' then nullif(trim(p ->> 'body'), '') else t.body end,
    due_date = case when p ? 'due_date' then nullif(p ->> 'due_date', '')::date else t.due_date end,
    status = case when p ->> 'status' in ('open', 'done') then p ->> 'status' else t.status end,
    done_at = case when p ->> 'status' = 'done' then coalesce(t.done_at, now())
                   when p ->> 'status' = 'open' then null else t.done_at end,
    updated_at = now()
  where id = p_id;
end;
$$;
grant execute on function public.portal_update_item(uuid, jsonb) to authenticated;

-- Customer deletes its own item.
create or replace function public.portal_delete_item(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.ops_tasks
  where id = p_id and from_portal and client_id = public.my_client_id();
  if not found then
    raise exception 'Not found';
  end if;
end;
$$;
grant execute on function public.portal_delete_item(uuid) to authenticated;

-- ---------- Private tasks and notes ----------
-- The customer's own notebook: only that customer's portal logins can read
-- or change these, ExPac staff can't. "Share with ExPac" moves an item into
-- ops_tasks (above, synced with Motion); "Make private" moves it back.
create or replace function public.client_owns(p_job uuid, p_quote uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_job is null or exists (select 1 from public.jobs where id = p_job and client_id = public.my_client_id()))
     and (p_quote is null or exists (select 1 from public.quotes where id = p_quote and client_id = public.my_client_id()));
$$;
grant execute on function public.client_owns(uuid, uuid) to authenticated;

create table if not exists public.client_private_items (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null default public.my_client_id() references public.clients (id) on delete cascade,
  kind        text not null default 'note' check (kind in ('task', 'note')),
  title       text not null,
  body        text,
  status      text not null default 'open' check (status in ('open', 'done')),
  due_date    date,
  job_id      uuid references public.jobs (id) on delete set null,
  quote_id    uuid references public.quotes (id) on delete set null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists client_private_items_client_idx on public.client_private_items (client_id);

alter table public.client_private_items enable row level security;
drop policy if exists "own customer only" on public.client_private_items;
create policy "own customer only" on public.client_private_items
  for all to authenticated
  using (client_id = public.my_client_id())
  with check (client_id = public.my_client_id() and public.client_owns(job_id, quote_id));

-- Share a private item with ExPac (it becomes a Motion task / note).
create or replace function public.portal_share_item(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  i public.client_private_items%rowtype;
  tid uuid;
begin
  select * into i from public.client_private_items where id = p_id;
  if not found or i.client_id is distinct from public.my_client_id() then
    raise exception 'Not found';
  end if;
  insert into public.ops_tasks (kind, title, body, status, priority, due_date, job_id, quote_id, client_id,
                                from_portal, portal_visible, created_by, created_at, done_at)
  values (i.kind, i.title, i.body, i.status, 'normal', i.due_date, i.job_id, i.quote_id, i.client_id,
          true, true, auth.uid(), now(), i.done_at)
  returning id into tid;
  delete from public.client_private_items where id = p_id;
  return tid;
end;
$$;
grant execute on function public.portal_share_item(uuid) to authenticated;

-- Make a shared item (the customer's own) private again.
create or replace function public.portal_unshare_item(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.ops_tasks%rowtype;
  pid uuid;
begin
  select * into t from public.ops_tasks where id = p_id;
  if not found or not t.from_portal or t.client_id is distinct from public.my_client_id() then
    raise exception 'Not found';
  end if;
  insert into public.client_private_items (client_id, kind, title, body, status, due_date, job_id, quote_id, created_by, done_at)
  values (t.client_id, t.kind, t.title, t.body, case when t.status = 'done' then 'done' else 'open' end,
          t.due_date, t.job_id, t.quote_id, auth.uid(), t.done_at)
  returning id into pid;
  delete from public.ops_tasks where id = p_id;
  return pid;
end;
$$;
grant execute on function public.portal_unshare_item(uuid) to authenticated;
