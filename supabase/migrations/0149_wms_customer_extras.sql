-- 0149: three customer warehouse extras.
--   1. Warehouse emails: each receipt remembers which stage emails went out
--      (received / checked / preparing / shipped); a per-customer switch.
--   2. Pre-advise incoming goods: the customer tells ExPac what's coming
--      (PA000001); ExPac receives against it in WMS.
--   3. Ship from stock: a portal quote request can carry the warehouse
--      receipts it is for; when the quote is won, its shipment is linked to
--      those receipts.

-- ---------- 1. Warehouse emails ----------
alter table public.wms_receipts
  add column if not exists notified jsonb not null default '{}'::jsonb; -- {received, checked, preparing, shipped: timestamp}
alter table public.clients
  add column if not exists wms_notify boolean not null default true;

-- wms_receipts_v selects r.*: re-create it so `notified` comes through.
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

-- ---------- 2. Pre-advise incoming goods ----------
create sequence if not exists public.wms_preadvice_seq;
grant usage, select on sequence public.wms_preadvice_seq to authenticated;

create table if not exists public.wms_preadvices (
  id uuid primary key default gen_random_uuid(),
  preadvice_no text not null unique
    default ('PA' || lpad(nextval('public.wms_preadvice_seq')::text, 6, '0')),
  client_id uuid not null references public.clients (id) on delete cascade,
  status text not null default 'expected' check (status in ('expected', 'received', 'cancelled')),
  supplier text,
  eta date,
  inbound_ref text,
  carrier text,
  description text,
  packages jsonb not null default '[]'::jsonb, -- [{sku, description, type, qty, length_cm, width_cm, height_cm, actual_kg}]
  notes text,
  receipt_id uuid references public.wms_receipts (id) on delete set null,
  task_id uuid references public.ops_tasks (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists wms_preadvices_client on public.wms_preadvices (client_id, created_at desc);
alter table public.wms_preadvices enable row level security;
drop policy if exists "wms users" on public.wms_preadvices;
create policy "wms users" on public.wms_preadvices for all to authenticated
  using (public.can_use_wms()) with check (public.can_use_wms());
drop policy if exists "portal own preadvices" on public.wms_preadvices;
create policy "portal own preadvices" on public.wms_preadvices for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists "delete needs permission" on public.wms_preadvices;
create policy "delete needs permission" on public.wms_preadvices as restrictive
  for delete to authenticated
  using (public.has_perm('delete') or not public.is_staff());

-- p: {supplier, eta, inbound_ref, carrier, description, notes, packages: [...]}
create or replace function public.portal_create_preadvice(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  pid uuid;
  pno text;
  tid uuid;
begin
  if cid is null then
    raise exception 'Only a customer portal login can pre-advise goods';
  end if;
  if coalesce(trim(p ->> 'supplier'), '') = '' and coalesce(trim(p ->> 'description'), '') = '' then
    raise exception 'Who is it from, or what is it? (supplier or description)';
  end if;
  insert into public.wms_preadvices (client_id, supplier, eta, inbound_ref, carrier, description, notes, packages)
  values (
    cid,
    nullif(trim(p ->> 'supplier'), ''),
    nullif(p ->> 'eta', '')::date,
    nullif(trim(p ->> 'inbound_ref'), ''),
    nullif(trim(p ->> 'carrier'), ''),
    nullif(trim(p ->> 'description'), ''),
    nullif(trim(p ->> 'notes'), ''),
    coalesce(p -> 'packages', '[]'::jsonb)
  ) returning id, preadvice_no into pid, pno;

  insert into public.ops_tasks (kind, title, body, status, priority, due_date, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Pre-advice ' || pno || ', goods on the way to the warehouse',
          'Receive against it in Motion WMS > Warehouse Receipt > Expected.',
          'open', 'normal', nullif(p ->> 'eta', '')::date, cid, true, false, auth.uid())
  returning id into tid;
  update public.wms_preadvices set task_id = tid where id = pid;
  return pid;
end;
$$;
grant execute on function public.portal_create_preadvice(jsonb) to authenticated;

create or replace function public.portal_cancel_preadvice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.wms_preadvices%rowtype;
begin
  select * into q from public.wms_preadvices where id = p_id;
  if not found or q.client_id is distinct from public.my_client_id() then
    raise exception 'Pre-advice not found';
  end if;
  if q.status <> 'expected' then
    raise exception 'These goods have already been received';
  end if;
  update public.wms_preadvices set status = 'cancelled' where id = p_id;
  update public.ops_tasks set status = 'done', done_at = now() where id = q.task_id and status <> 'done';
end;
$$;
grant execute on function public.portal_cancel_preadvice(uuid) to authenticated;

-- ---------- 3. Ship from stock ----------
alter table public.quotes
  add column if not exists wms_receipt_ids uuid[] not null default '{}';

-- portal_request_quote (0141) + p.receipt_ids: only the customer's own receipts are kept.
create or replace function public.portal_request_quote(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  qid uuid;
  ref text;
  prefix text;
  m text := coalesce(nullif(p ->> 'mode', ''), 'Air Freight (AIR)');
  item jsonb;
  pos int := 0;
  sp uuid;
  rids uuid[];
begin
  if cid is null then
    raise exception 'Only a customer portal login can request a quote';
  end if;
  if m not in ('Air Freight (AIR)', 'Courier Express (CX)', 'Sea Freight (FCL)', 'Sea Freight (LCL)', 'Road Freight (RDX)') then
    raise exception 'Unknown mode %', m;
  end if;
  prefix := case
    when m ilike 'sea%' then 'SEA'
    when m ilike 'road%' then 'RDX'
    when m ilike 'courier%' then 'CX'
    else 'AIR'
  end;
  loop
    ref := prefix || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.quotes where reference = ref)
          and not exists (select 1 from public.jobs where reference = ref);
  end loop;
  select sales_person_id into sp from public.clients where id = cid;
  select coalesce(array_agg(r.id), '{}') into rids
  from public.wms_receipts r
  where r.client_id = cid
    and r.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'receipt_ids', '[]'::jsonb)) x);

  insert into public.quotes (
    reference, client_id, mode, commodity, origin, destination, incoterms,
    customer_reference, commercial_value, value_currency, status, sales_person_id,
    portal_requested_at, portal_requested_by, request_ready_date, request_pickup,
    request_delivery, request_notes, wms_receipt_ids
  ) values (
    ref, cid, m,
    nullif(p ->> 'commodity', ''), nullif(p ->> 'origin', ''), nullif(p ->> 'destination', ''),
    nullif(p ->> 'incoterms', ''), nullif(p ->> 'customer_reference', ''),
    nullif(p ->> 'commercial_value', '')::numeric,
    coalesce(nullif(p ->> 'value_currency', ''), 'ZAR'),
    'open', sp,
    now(), auth.uid(), nullif(p ->> 'ready_date', '')::date,
    nullif(p ->> 'pickup', ''), nullif(p ->> 'delivery', ''), nullif(p ->> 'notes', ''),
    rids
  ) returning id into qid;

  for item in select * from jsonb_array_elements(coalesce(p -> 'packing', '[]'::jsonb)) loop
    insert into public.packing_list_items (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
    values (
      qid, pos,
      coalesce(nullif(item ->> 'length_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'width_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'height_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'actual_kg', '')::numeric, 0),
      coalesce(nullif(item ->> 'qty_ctns', '')::numeric, 0)
    );
    pos := pos + 1;
  end loop;
  return qid;
end;
$$;
grant execute on function public.portal_request_quote(jsonb) to authenticated;

-- When a quote with warehouse receipts becomes a shipment, link the receipts to it.
create or replace function public.wms_link_receipts_to_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rids uuid[];
begin
  if new.quote_id is null then
    return new;
  end if;
  select wms_receipt_ids into rids from public.quotes where id = new.quote_id;
  if rids is not null and array_length(rids, 1) > 0 then
    update public.wms_receipts set job_id = new.id where id = any (rids) and job_id is null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_wms_link_receipts_to_job on public.jobs;
create trigger trg_wms_link_receipts_to_job
  after insert on public.jobs
  for each row execute function public.wms_link_receipts_to_job();

-- Customer view of quotes: + the receipts a request is for (appended column).
create or replace view public.client_quotes
with (security_barrier = true) as
select
  q.id, q.reference, q.client_id, q.mode, q.commodity, q.origin, q.destination,
  q.delivery_terms, q.valid_until, q.status, q.commercial_value,
  q.insurance_amount, q.vessel_name, q.mbl_no, q.hbl_no, q.container_no,
  q.etd, q.eta, q.incoterms, q.mawb_no, q.hawb_no, q.flight_no, q.flight_date,
  q.carrier_name, q.created_at,
  s.company as supplier_company,
  q.customer_reference, q.portal_requested_at, q.request_ready_date, q.request_pickup,
  q.request_delivery, q.request_notes, q.portal_decision, q.portal_decided_at,
  q.portal_decline_reason, q.sell_currency, q.accepted_at,
  q.wms_receipt_ids
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
where q.client_id = public.my_client_id();
grant select on public.client_quotes to authenticated;
