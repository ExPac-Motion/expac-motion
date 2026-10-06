-- 0148: release requests from the Customer Portal. The customer asks for
-- goods in store to go out (collect or deliver, date, address / collector);
-- ExPac sees it in WMS > Warehouse Release > Release requests (+ a Control
-- Tower task and notification), books the release from it, or declines it.

create sequence if not exists public.wms_release_request_seq;
grant usage, select on sequence public.wms_release_request_seq to authenticated;

create table if not exists public.wms_release_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique
    default ('RR' || lpad(nextval('public.wms_release_request_seq')::text, 6, '0')),
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'released', 'declined', 'cancelled')),
  method text not null default 'collect' check (method in ('collect', 'deliver')),
  required_date date,
  deliver_to text,
  collector_name text,
  collector_vehicle text,
  collector_id_no text,
  contact text,
  notes text,
  lines jsonb not null default '[]'::jsonb, -- [{receipt_id, pieces}]
  release_id uuid references public.wms_releases (id) on delete set null,
  decline_reason text,
  task_id uuid references public.ops_tasks (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wms_release_requests_client on public.wms_release_requests (client_id, created_at desc);

alter table public.wms_release_requests enable row level security;
drop policy if exists "wms users" on public.wms_release_requests;
create policy "wms users" on public.wms_release_requests for all to authenticated
  using (public.can_use_wms()) with check (public.can_use_wms());
drop policy if exists "portal own release requests" on public.wms_release_requests;
create policy "portal own release requests" on public.wms_release_requests for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "delete needs permission" on public.wms_release_requests;
create policy "delete needs permission" on public.wms_release_requests as restrictive
  for delete to authenticated
  using (public.has_perm('delete') or not public.is_staff());

-- p: {method, required_date, deliver_to, collector_name, collector_vehicle,
--     collector_id_no, contact, notes, lines: [{receipt_id, pieces}]}
create or replace function public.portal_request_release(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  l jsonb;
  r public.wms_receipts%rowtype;
  have int;
  want int;
  n int := 0;
  rid uuid;
  rno text;
  tid uuid;
  clean jsonb := '[]'::jsonb;
begin
  if cid is null then
    raise exception 'Only a customer portal login can request a release';
  end if;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    want := coalesce((l ->> 'pieces')::int, 0);
    continue when want <= 0;
    select * into r from public.wms_receipts where id = (l ->> 'receipt_id')::uuid;
    if not found or r.client_id is distinct from cid then
      raise exception 'That receipt is not yours';
    end if;
    select coalesce(sum(qty), 0)::int into have from public.wms_stock_moves where receipt_id = r.id;
    if want > have then
      raise exception 'Only % piece(s) of % are in store', have, r.receipt_no;
    end if;
    clean := clean || jsonb_build_array(jsonb_build_object('receipt_id', r.id, 'pieces', want));
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'Pick the goods to release';
  end if;
  if coalesce(p ->> 'method', 'collect') = 'deliver' and coalesce(trim(p ->> 'deliver_to'), '') = '' then
    raise exception 'Where should we deliver? (delivery address)';
  end if;

  insert into public.wms_release_requests (
    client_id, method, required_date, deliver_to, collector_name, collector_vehicle,
    collector_id_no, contact, notes, lines
  ) values (
    cid,
    case when p ->> 'method' = 'deliver' then 'deliver' else 'collect' end,
    nullif(p ->> 'required_date', '')::date,
    nullif(trim(p ->> 'deliver_to'), ''),
    nullif(trim(p ->> 'collector_name'), ''),
    nullif(trim(p ->> 'collector_vehicle'), ''),
    nullif(trim(p ->> 'collector_id_no'), ''),
    nullif(trim(p ->> 'contact'), ''),
    nullif(trim(p ->> 'notes'), ''),
    clean
  ) returning id, request_no into rid, rno;

  -- A Control Tower task for the team (shows as a customer request).
  insert into public.ops_tasks (kind, title, body, status, priority, due_date, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Release request ' || rno || ', book the release in Motion WMS',
          'Customer requested a warehouse release (' ||
            case when p ->> 'method' = 'deliver' then 'deliver' else 'collect' end ||
            '), see Motion WMS > Warehouse Release > Release requests.',
          'open', 'high', nullif(p ->> 'required_date', '')::date, cid, true, false, auth.uid())
  returning id into tid;
  update public.wms_release_requests set task_id = tid where id = rid;
  return rid;
end;
$$;
grant execute on function public.portal_request_release(jsonb) to authenticated;

create or replace function public.portal_cancel_release_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.wms_release_requests%rowtype;
begin
  select * into q from public.wms_release_requests where id = p_id;
  if not found or q.client_id is distinct from public.my_client_id() then
    raise exception 'Request not found';
  end if;
  if q.status <> 'requested' then
    raise exception 'This request has already been handled';
  end if;
  update public.wms_release_requests set status = 'cancelled', processed_at = now() where id = p_id;
  update public.ops_tasks set status = 'done', done_at = now() where id = q.task_id and status <> 'done';
end;
$$;
grant execute on function public.portal_cancel_release_request(uuid) to authenticated;
