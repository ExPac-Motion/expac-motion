-- 0150: value-added service requests + exception acknowledgements.
--   * Service requests (VS000001): the customer asks for labelling,
--     repacking, palletising, photos, inspection or another service on its
--     receipts; ExPac works them in Motion WMS > Warehouse Billing, sets the
--     charge when done, and done charges go on the next storage billing run.
--   * Exceptions: a receipt received damaged / wet / short / over / repacked
--     is reported to the customer, who acknowledges it (with a comment).
--   (Running storage cost is worked out in the portal from the warehouse
--   rates the customer can already read.)

-- ---------- Service requests ----------
create sequence if not exists public.wms_service_seq;
grant usage, select on sequence public.wms_service_seq to authenticated;

create table if not exists public.wms_service_requests (
  id uuid primary key default gen_random_uuid(),
  service_no text not null unique
    default ('VS' || lpad(nextval('public.wms_service_seq')::text, 6, '0')),
  client_id uuid not null references public.clients (id) on delete cascade,
  receipt_ids uuid[] not null default '{}',
  service text not null,
  qty numeric(12, 2),
  notes text,
  required_date date,
  status text not null default 'requested'
    check (status in ('requested', 'in_progress', 'done', 'declined', 'cancelled')),
  charge_code text,
  charge_amount numeric(12, 2),
  staff_note text,
  completed_at timestamptz,
  billed_run_id uuid references public.wms_billing_runs (id) on delete set null,
  task_id uuid references public.ops_tasks (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists wms_service_requests_client on public.wms_service_requests (client_id, created_at desc);
alter table public.wms_service_requests enable row level security;
drop policy if exists "wms users" on public.wms_service_requests;
create policy "wms users" on public.wms_service_requests for all to authenticated
  using (public.can_use_wms()) with check (public.can_use_wms());
drop policy if exists "portal own services" on public.wms_service_requests;
create policy "portal own services" on public.wms_service_requests for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "delete needs permission" on public.wms_service_requests;
create policy "delete needs permission" on public.wms_service_requests as restrictive
  for delete to authenticated
  using (public.has_perm('delete') or not public.is_staff());

-- p: {service, qty, notes, required_date, receipt_ids: [uuid]}
create or replace function public.portal_request_service(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  rids uuid[];
  sid uuid;
  sno text;
  tid uuid;
begin
  if cid is null then
    raise exception 'Only a customer portal login can request a service';
  end if;
  if coalesce(trim(p ->> 'service'), '') = '' then
    raise exception 'Which service do you need?';
  end if;
  select coalesce(array_agg(r.id), '{}') into rids
  from public.wms_receipts r
  where r.client_id = cid
    and r.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'receipt_ids', '[]'::jsonb)) x);
  insert into public.wms_service_requests (client_id, receipt_ids, service, qty, notes, required_date)
  values (
    cid, rids, trim(p ->> 'service'),
    nullif(p ->> 'qty', '')::numeric,
    nullif(trim(p ->> 'notes'), ''),
    nullif(p ->> 'required_date', '')::date
  ) returning id, service_no into sid, sno;
  insert into public.ops_tasks (kind, title, body, status, priority, due_date, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Service request ' || sno || ', ' || trim(p ->> 'service'),
          'Customer asked for a warehouse service, see Motion WMS > Warehouse Billing > Service requests.',
          'open', 'normal', nullif(p ->> 'required_date', '')::date, cid, true, false, auth.uid())
  returning id into tid;
  update public.wms_service_requests set task_id = tid where id = sid;
  return sid;
end;
$$;
grant execute on function public.portal_request_service(jsonb) to authenticated;

create or replace function public.portal_cancel_service(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.wms_service_requests%rowtype;
begin
  select * into q from public.wms_service_requests where id = p_id;
  if not found or q.client_id is distinct from public.my_client_id() then
    raise exception 'Request not found';
  end if;
  if q.status <> 'requested' then
    raise exception 'This request is already being handled';
  end if;
  update public.wms_service_requests set status = 'cancelled' where id = p_id;
  update public.ops_tasks set status = 'done', done_at = now() where id = q.task_id and status <> 'done';
end;
$$;
grant execute on function public.portal_cancel_service(uuid) to authenticated;

-- ---------- Exception acknowledgement ----------
alter table public.wms_receipts
  add column if not exists exception_ack_at timestamptz,
  add column if not exists exception_ack_by uuid references public.profiles (id) on delete set null,
  add column if not exists exception_customer_note text;

-- wms_receipts_v selects r.*: re-create it so the new columns come through.
drop view if exists public.wms_receipts_v;
create view public.wms_receipts_v with (security_invoker = true) as
select r.*,
  coalesce(s.on_hand, 0) as on_hand,
  case when r.pieces > 0 then round(r.gross_kg * coalesce(s.on_hand, 0) / r.pieces, 2) else 0 end as on_hand_kg,
  case when r.pieces > 0 then round(r.volume_cbm * coalesce(s.on_hand, 0) / r.pieces, 3) else 0 end as on_hand_cbm,
  s.last_out_at,
  case
    when r.pieces = 0 then 'in_store'
    when coalesce(s.on_hand, 0) <= 0 then 'released'
    when coalesce(s.on_hand, 0) < r.pieces then 'part_released'
    else 'in_store'
  end as status
from public.wms_receipts r
left join lateral (
  select sum(m.qty)::int as on_hand,
         max(m.at) filter (where m.kind = 'release') as last_out_at
  from public.wms_stock_moves m where m.receipt_id = r.id
) s on true;
grant select on public.wms_receipts_v to authenticated;

create or replace function public.portal_ack_exception(p_receipt uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.wms_receipts%rowtype;
begin
  select * into r from public.wms_receipts where id = p_receipt;
  if not found or r.client_id is distinct from public.my_client_id() then
    raise exception 'Receipt not found';
  end if;
  update public.wms_receipts set
    exception_ack_at = now(),
    exception_ack_by = auth.uid(),
    exception_customer_note = nullif(trim(p_note), '')
  where id = p_receipt;
end;
$$;
grant execute on function public.portal_ack_exception(uuid, text) to authenticated;
