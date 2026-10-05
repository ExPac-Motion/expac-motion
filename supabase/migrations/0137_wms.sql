-- 0137: WMS — Warehouse Management System (top-nav "WMS", next to Quotations).
--
--   Settings        warehouses (with their storage billing rates) + zones / bays
--   Receipt         goods received (WR000001) — customer, optional shipment,
--                   pieces / pallets / kg / CBM, package items (SKU, qty, dims), condition
--   Movements       bay-to-bay moves (MV000001)
--   Release         goods out (RL000001), part or full, plus air consolidations
--                   (CN000001) printing MAWB / HAWB / Manifest
--   Inventory       on hand per receipt per bay — everything is one ledger,
--                   wms_stock_moves (+ in / − out, in pieces)
--   Billing         storage runs per customer per period (SB000001)
--   Cycle Count     count sheets (CC000001); completing posts the variances
--
-- Access: Admin, or a Standard User with the new "warehouse" permission (on
-- by default). Customer Portal logins can already read their own receipts,
-- stock and releases — the portal screens come later.

-- ---------- 1. Permission "warehouse" ----------
create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user": {
      "ops": true, "shipments": true, "quotes": true, "warehouse": true, "customs": true,
      "customers": true, "suppliers": true, "leads": true, "inbox": false,
      "rates": false, "settings": true, "crm": true, "delete": false
    },
    "partner": {"delete_sheets": false, "edit_coverage": false, "see_history": false}
  }'::jsonb;
  v text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    return false;
  end if;
  if me.role = 'admin' then
    return true;
  end if;
  role_key := case
    when me.role = 'user' then 'user'
    when me.role = 'partner' and me.partner_id is not null then 'partner'
  end;
  if role_key is null then
    return false;
  end if;
  v := me.permissions ->> p_key;
  if v is null then
    select role_permissions -> role_key ->> p_key into v from public.company_settings where id = 1;
  end if;
  if v is null then
    v := defaults -> role_key ->> p_key;
  end if;
  return coalesce(v::boolean, false);
end;
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, public.has_perm(k))
  from unnest(array[
    'ops', 'shipments', 'quotes', 'warehouse', 'customs', 'customers', 'suppliers', 'leads', 'inbox',
    'rates', 'settings', 'crm', 'delete',
    'delete_sheets', 'edit_coverage', 'see_history'
  ]) as k;
$$;
grant execute on function public.my_permissions() to authenticated;

create or replace function public.can_use_wms()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and public.has_perm('warehouse'));
$$;
grant execute on function public.can_use_wms() to authenticated;

-- ---------- 2. Numbering ----------
create sequence if not exists public.wms_receipt_seq;
create sequence if not exists public.wms_movement_seq;
create sequence if not exists public.wms_release_seq;
create sequence if not exists public.wms_consol_seq;
create sequence if not exists public.wms_count_seq;
create sequence if not exists public.wms_billing_seq;
grant usage, select on sequence public.wms_receipt_seq, public.wms_movement_seq, public.wms_release_seq,
  public.wms_consol_seq, public.wms_count_seq, public.wms_billing_seq to authenticated;

-- ---------- 3. Settings: warehouses + locations ----------
create table if not exists public.wms_warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  active boolean not null default true,
  -- Storage billing: rate per basis unit per period, after free days.
  storage_basis text not null default 'cbm' check (storage_basis in ('cbm', 'pallet', 'kg')),
  storage_period text not null default 'week' check (storage_period in ('day', 'week', 'month')),
  storage_rate numeric(12, 2) not null default 0,
  free_days int not null default 7 check (free_days >= 0),
  min_charge numeric(12, 2) not null default 0,
  -- Handling in / out, per CBM (W/M: 1 CBM = 1000 kg).
  handling_in_rate numeric(12, 2) not null default 0,
  handling_out_rate numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.wms_warehouses (id) on delete cascade,
  zone text,
  code text not null,
  name text,
  kind text not null default 'bay'
    check (kind in ('bay', 'area', 'bonded', 'yard', 'cold', 'dg', 'quarantine', 'dock')),
  capacity_cbm numeric(12, 3),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code)
);

-- ---------- 4. Warehouse Receipt ----------
create table if not exists public.wms_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique
    default ('WR' || lpad(nextval('public.wms_receipt_seq')::text, 6, '0')),
  warehouse_id uuid not null references public.wms_warehouses (id),
  location_id uuid references public.wms_locations (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  received_at timestamptz not null default now(),
  received_by uuid references public.profiles (id) on delete set null default auth.uid(),
  delivered_by text,
  vehicle_reg text,
  driver_name text,
  inbound_ref text,
  customer_reference text,
  description text,
  marks text,
  package_type text,
  pieces int not null default 0 check (pieces >= 0),
  pallets int not null default 0 check (pallets >= 0),
  gross_kg numeric(12, 2) not null default 0,
  volume_cbm numeric(12, 3) not null default 0,
  packages jsonb not null default '[]'::jsonb, -- package items [{sku, description, type, qty, length_cm, width_cm, height_cm, actual_kg}]
  condition text not null default 'good'
    check (condition in ('good', 'damaged', 'wet', 'short', 'over', 'repacked')),
  condition_notes text,
  hazardous boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists wms_receipts_client on public.wms_receipts (client_id);
create index if not exists wms_receipts_job on public.wms_receipts (job_id);
create index if not exists wms_receipts_received on public.wms_receipts (received_at desc);

-- The stock ledger: every receipt / move / release / count adjustment, in pieces.
create table if not exists public.wms_stock_moves (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.wms_receipts (id) on delete cascade,
  location_id uuid references public.wms_locations (id) on delete set null,
  qty int not null,
  kind text not null check (kind in ('receipt', 'move', 'release', 'adjust')),
  ref_id uuid,
  at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists wms_stock_moves_receipt on public.wms_stock_moves (receipt_id, location_id);
create index if not exists wms_stock_moves_ref on public.wms_stock_moves (ref_id);

-- Pieces of a receipt on hand in one location (null = unassigned).
create or replace function public.wms_on_hand(p_receipt uuid, p_location uuid)
returns int language sql stable security invoker set search_path = public as $$
  select coalesce(sum(qty), 0)::int from public.wms_stock_moves
  where receipt_id = p_receipt and location_id is not distinct from p_location;
$$;
grant execute on function public.wms_on_hand(uuid, uuid) to authenticated;

-- The receipt's own ledger row follows its pieces / first bay / date. Once
-- anything has moved or left, pieces and bay are locked (the app greys them).
create or replace function public.wms_receipt_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (new.pieces is distinct from old.pieces or new.location_id is distinct from old.location_id)
     and exists (select 1 from public.wms_stock_moves where receipt_id = new.id and kind <> 'receipt') then
    raise exception 'Stock on % has already moved or been released — pieces and bay can''t change now (use a movement or cycle count).', new.receipt_no;
  end if;
  delete from public.wms_stock_moves where receipt_id = new.id and kind = 'receipt';
  if new.pieces > 0 then
    insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
    values (new.id, new.location_id, new.pieces, 'receipt', new.id, new.received_at);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_wms_receipt_ledger on public.wms_receipts;
create trigger trg_wms_receipt_ledger
  after insert or update of pieces, location_id, received_at on public.wms_receipts
  for each row execute function public.wms_receipt_ledger();

-- ---------- 5. Movements ----------
create table if not exists public.wms_movements (
  id uuid primary key default gen_random_uuid(),
  movement_no text not null unique
    default ('MV' || lpad(nextval('public.wms_movement_seq')::text, 6, '0')),
  receipt_id uuid not null references public.wms_receipts (id) on delete cascade,
  from_location_id uuid references public.wms_locations (id) on delete set null,
  to_location_id uuid references public.wms_locations (id) on delete set null,
  pieces int not null check (pieces > 0),
  reason text,
  moved_at timestamptz not null default now(),
  moved_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists wms_movements_receipt on public.wms_movements (receipt_id);

create or replace function public.wms_movement_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  avail int;
begin
  if tg_op = 'DELETE' then
    -- Undoing a move: the pieces must still be in the bay they went to.
    -- (Skipped when the whole receipt is being deleted.)
    if exists (select 1 from public.wms_receipts where id = old.receipt_id)
       and public.wms_on_hand(old.receipt_id, old.to_location_id) < old.pieces then
      raise exception 'Those pieces have moved on or left since — undo the later movement / release first.';
    end if;
    delete from public.wms_stock_moves where ref_id = old.id and kind = 'move';
    return old;
  end if;
  if new.from_location_id is not distinct from new.to_location_id then
    raise exception 'Pick a different bay to move to.';
  end if;
  avail := public.wms_on_hand(new.receipt_id, new.from_location_id);
  if new.pieces > avail then
    raise exception 'Only % piece(s) of this receipt are in that bay.', avail;
  end if;
  insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at) values
    (new.receipt_id, new.from_location_id, -new.pieces, 'move', new.id, new.moved_at),
    (new.receipt_id, new.to_location_id, new.pieces, 'move', new.id, new.moved_at);
  return new;
end;
$$;
drop trigger if exists trg_wms_movement_ledger on public.wms_movements;
create trigger trg_wms_movement_ledger
  after insert or delete on public.wms_movements
  for each row execute function public.wms_movement_ledger();

-- ---------- 6. Consolidations (air: MAWB / HAWB / Manifest) ----------
create table if not exists public.wms_consols (
  id uuid primary key default gen_random_uuid(),
  consol_no text not null unique
    default ('CN' || lpad(nextval('public.wms_consol_seq')::text, 6, '0')),
  mode text not null default 'air' check (mode in ('air', 'sea')),
  warehouse_id uuid references public.wms_warehouses (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed', 'departed')),
  master_no text,
  carrier text,
  flight_no text,
  flight_date date,
  origin text,
  origin_name text,
  destination text,
  routing jsonb not null default '[]'::jsonb, -- [{to, by}] up to 3 legs
  shipper text,
  consignee text,
  accounting_info text,
  agent_name text,
  agent_iata text,
  agent_account text,
  currency text not null default 'USD',
  charges_code text not null default 'CC' check (charges_code in ('PP', 'CC')),
  declared_carriage text not null default 'NVD',
  declared_customs text not null default 'NCV',
  insurance text not null default 'NIL',
  handling_info text,
  rate_class text default 'K',
  rate_charge text,
  total_charge text not null default 'AS AGREED',
  signed_by text,
  executed_on date,
  executed_place text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_consol_houses (
  id uuid primary key default gen_random_uuid(),
  consol_id uuid not null references public.wms_consols (id) on delete cascade,
  position int not null default 0,
  house_no text,
  client_id uuid references public.clients (id) on delete set null,
  shipper text,
  consignee text,
  accounting_info text,
  nature_of_goods text,
  handling_info text,
  pieces int not null default 0,
  gross_kg numeric(12, 2) not null default 0,
  chargeable_kg numeric(12, 2) not null default 0,
  volume_cbm numeric(12, 3) not null default 0,
  receipt_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists wms_consol_houses_consol on public.wms_consol_houses (consol_id);

-- ---------- 7. Release ----------
create table if not exists public.wms_releases (
  id uuid primary key default gen_random_uuid(),
  release_no text not null unique
    default ('RL' || lpad(nextval('public.wms_release_seq')::text, 6, '0')),
  warehouse_id uuid references public.wms_warehouses (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  job_id uuid references public.jobs (id) on delete set null,
  consol_id uuid references public.wms_consols (id) on delete set null,
  released_at timestamptz not null default now(),
  released_by uuid references public.profiles (id) on delete set null default auth.uid(),
  collected_by text,
  vehicle_reg text,
  driver_id_no text,
  deliver_to text,
  outbound_ref text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_release_lines (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.wms_releases (id) on delete cascade,
  receipt_id uuid not null references public.wms_receipts (id) on delete cascade,
  location_id uuid references public.wms_locations (id) on delete set null,
  pieces int not null check (pieces > 0),
  gross_kg numeric(12, 2) not null default 0,
  volume_cbm numeric(12, 3) not null default 0
);
create index if not exists wms_release_lines_release on public.wms_release_lines (release_id);
create index if not exists wms_release_lines_receipt on public.wms_release_lines (receipt_id);

create or replace function public.wms_release_line_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  avail int;
  at_ts timestamptz;
begin
  if tg_op = 'DELETE' then
    delete from public.wms_stock_moves where ref_id = old.id and kind = 'release';
    return old;
  end if;
  avail := public.wms_on_hand(new.receipt_id, new.location_id);
  if new.pieces > avail then
    raise exception 'Only % piece(s) of % are on hand there.', avail,
      (select receipt_no from public.wms_receipts where id = new.receipt_id);
  end if;
  select released_at into at_ts from public.wms_releases where id = new.release_id;
  insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
  values (new.receipt_id, new.location_id, -new.pieces, 'release', new.id, coalesce(at_ts, now()));
  return new;
end;
$$;
drop trigger if exists trg_wms_release_line_ledger on public.wms_release_lines;
create trigger trg_wms_release_line_ledger
  after insert or delete on public.wms_release_lines
  for each row execute function public.wms_release_line_ledger();

create or replace function public.wms_release_date_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.wms_stock_moves m set at = new.released_at
  from public.wms_release_lines l
  where l.release_id = new.id and m.ref_id = l.id and m.kind = 'release';
  return new;
end;
$$;
drop trigger if exists trg_wms_release_date_sync on public.wms_releases;
create trigger trg_wms_release_date_sync
  after update of released_at on public.wms_releases
  for each row execute function public.wms_release_date_sync();

-- One release for goods leaving in several receipts / bays (Release modal).
-- p_lines: [{receipt_id, location_id, pieces}] — kg / CBM follow pro rata.
create or replace function public.wms_create_release(p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  rid uuid;
  l jsonb;
  r public.wms_receipts%rowtype;
  pcs int;
begin
  if not public.can_use_wms() then
    raise exception 'No warehouse access';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Nothing to release';
  end if;
  insert into public.wms_releases (
    warehouse_id, client_id, job_id, consol_id, released_at, collected_by, vehicle_reg,
    driver_id_no, deliver_to, outbound_ref, notes
  ) values (
    nullif(p_header ->> 'warehouse_id', '')::uuid,
    nullif(p_header ->> 'client_id', '')::uuid,
    nullif(p_header ->> 'job_id', '')::uuid,
    nullif(p_header ->> 'consol_id', '')::uuid,
    coalesce(nullif(p_header ->> 'released_at', '')::timestamptz, now()),
    nullif(p_header ->> 'collected_by', ''),
    nullif(p_header ->> 'vehicle_reg', ''),
    nullif(p_header ->> 'driver_id_no', ''),
    nullif(p_header ->> 'deliver_to', ''),
    nullif(p_header ->> 'outbound_ref', ''),
    nullif(p_header ->> 'notes', '')
  ) returning id into rid;
  for l in select * from jsonb_array_elements(p_lines) loop
    pcs := coalesce((l ->> 'pieces')::int, 0);
    continue when pcs <= 0;
    select * into r from public.wms_receipts where id = (l ->> 'receipt_id')::uuid;
    insert into public.wms_release_lines (release_id, receipt_id, location_id, pieces, gross_kg, volume_cbm)
    values (
      rid, r.id, nullif(l ->> 'location_id', '')::uuid, pcs,
      case when r.pieces > 0 then round(r.gross_kg * pcs / r.pieces, 2) else 0 end,
      case when r.pieces > 0 then round(r.volume_cbm * pcs / r.pieces, 3) else 0 end
    );
  end loop;
  return rid;
end;
$$;
grant execute on function public.wms_create_release(jsonb, jsonb) to authenticated;

-- Ship a consolidation: releases everything still on hand on its houses'
-- receipts and marks it departed.
create or replace function public.wms_release_consol(p_consol uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  c public.wms_consols%rowtype;
  lines jsonb;
  rid uuid;
begin
  if not public.can_use_wms() then
    raise exception 'No warehouse access';
  end if;
  select * into c from public.wms_consols where id = p_consol;
  if not found then
    raise exception 'Consolidation not found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'receipt_id', s.receipt_id, 'location_id', s.location_id, 'pieces', s.on_hand)), '[]'::jsonb)
    into lines
  from (
    select m.receipt_id, m.location_id, sum(m.qty)::int as on_hand
    from public.wms_stock_moves m
    where m.receipt_id in (
      select unnest(h.receipt_ids) from public.wms_consol_houses h where h.consol_id = p_consol
    )
    group by m.receipt_id, m.location_id
    having sum(m.qty) > 0
  ) s;
  if jsonb_array_length(lines) = 0 then
    raise exception 'None of this consolidation''s receipts have stock on hand.';
  end if;
  rid := public.wms_create_release(jsonb_build_object(
    'warehouse_id', c.warehouse_id, 'job_id', c.job_id, 'consol_id', c.id,
    'outbound_ref', c.master_no,
    'notes', 'Consolidation ' || c.consol_no || coalesce(' — MAWB ' || c.master_no, '')
  ), lines);
  update public.wms_consols set status = 'departed' where id = p_consol;
  return rid;
end;
$$;
grant execute on function public.wms_release_consol(uuid) to authenticated;

-- ---------- 8. Cycle Count ----------
create table if not exists public.wms_counts (
  id uuid primary key default gen_random_uuid(),
  count_no text not null unique
    default ('CC' || lpad(nextval('public.wms_count_seq')::text, 6, '0')),
  warehouse_id uuid not null references public.wms_warehouses (id) on delete cascade,
  location_id uuid references public.wms_locations (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  counted_by uuid references public.profiles (id) on delete set null default auth.uid(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.wms_counts (id) on delete cascade,
  receipt_id uuid not null references public.wms_receipts (id) on delete cascade,
  location_id uuid references public.wms_locations (id) on delete set null,
  expected int not null default 0,
  counted int check (counted is null or counted >= 0),
  note text
);
create index if not exists wms_count_lines_count on public.wms_count_lines (count_id);

-- Starts a count sheet from what the system says is in the warehouse / bay.
create or replace function public.wms_start_count(p_warehouse uuid, p_location uuid, p_notes text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  cid uuid;
begin
  if not public.can_use_wms() then
    raise exception 'No warehouse access';
  end if;
  insert into public.wms_counts (warehouse_id, location_id, notes)
  values (p_warehouse, p_location, nullif(p_notes, ''))
  returning id into cid;
  insert into public.wms_count_lines (count_id, receipt_id, location_id, expected)
  select cid, m.receipt_id, m.location_id, sum(m.qty)::int
  from public.wms_stock_moves m
  join public.wms_receipts r on r.id = m.receipt_id
  where r.warehouse_id = p_warehouse
    and (p_location is null or m.location_id = p_location)
  group by m.receipt_id, m.location_id
  having sum(m.qty) <> 0;
  return cid;
end;
$$;
grant execute on function public.wms_start_count(uuid, uuid, text) to authenticated;

-- Completes a count: every counted line that differs from what's on hand
-- now posts an adjustment to the ledger.
create or replace function public.wms_complete_count(p_count uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare
  l public.wms_count_lines%rowtype;
  cur int;
  n int := 0;
begin
  if not public.can_use_wms() then
    raise exception 'No warehouse access';
  end if;
  if (select status from public.wms_counts where id = p_count) <> 'open' then
    raise exception 'This count is already closed.';
  end if;
  for l in select * from public.wms_count_lines where count_id = p_count and counted is not null loop
    cur := public.wms_on_hand(l.receipt_id, l.location_id);
    if l.counted <> cur then
      insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id)
      values (l.receipt_id, l.location_id, l.counted - cur, 'adjust', l.id);
      n := n + 1;
    end if;
  end loop;
  update public.wms_counts set status = 'completed', completed_at = now() where id = p_count;
  return n;
end;
$$;
grant execute on function public.wms_complete_count(uuid) to authenticated;

-- ---------- 9. Billing (storage) runs ----------
create table if not exists public.wms_billing_runs (
  id uuid primary key default gen_random_uuid(),
  run_no text not null unique
    default ('SB' || lpad(nextval('public.wms_billing_seq')::text, 6, '0')),
  client_id uuid references public.clients (id) on delete set null,
  warehouse_id uuid references public.wms_warehouses (id) on delete set null,
  period_from date not null,
  period_to date not null,
  lines jsonb not null default '[]'::jsonb,
  subtotal numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'invoiced')),
  invoice_no text,
  invoiced_at date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ---------- 10. Views ----------
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

drop view if exists public.wms_stock_v;
create view public.wms_stock_v with (security_invoker = true) as
select m.receipt_id, m.location_id, sum(m.qty)::int as on_hand
from public.wms_stock_moves m
group by m.receipt_id, m.location_id
having sum(m.qty) <> 0;
grant select on public.wms_stock_v to authenticated;

-- ---------- 11. Row level security ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'wms_warehouses', 'wms_locations', 'wms_receipts', 'wms_stock_moves', 'wms_movements',
    'wms_consols', 'wms_consol_houses', 'wms_releases', 'wms_release_lines',
    'wms_counts', 'wms_count_lines', 'wms_billing_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "wms users" on public.%I', t);
    execute format(
      'create policy "wms users" on public.%I for all to authenticated
         using (public.can_use_wms()) with check (public.can_use_wms())', t);
  end loop;
  -- Deleting a WMS record needs the delete permission, like every other record (0132).
  foreach t in array array[
    'wms_warehouses', 'wms_locations', 'wms_receipts', 'wms_movements', 'wms_consols',
    'wms_releases', 'wms_counts', 'wms_billing_runs'
  ] loop
    execute format('drop policy if exists "delete needs permission" on public.%I', t);
    execute format(
      'create policy "delete needs permission" on public.%I as restrictive
         for delete to authenticated
         using (public.has_perm(''delete'') or not public.is_staff())', t);
  end loop;
end $$;

-- Customer Portal (later): a customer reads its own receipts, stock and releases.
drop policy if exists "portal own receipts" on public.wms_receipts;
create policy "portal own receipts" on public.wms_receipts for select to authenticated
  using (client_id is not null and client_id = public.my_client_id());
drop policy if exists "portal own stock" on public.wms_stock_moves;
create policy "portal own stock" on public.wms_stock_moves for select to authenticated
  using (exists (
    select 1 from public.wms_receipts r
    where r.id = receipt_id and r.client_id is not null and r.client_id = public.my_client_id()
  ));
drop policy if exists "portal own releases" on public.wms_releases;
create policy "portal own releases" on public.wms_releases for select to authenticated
  using (client_id is not null and client_id = public.my_client_id());

-- ---------- 12. A first warehouse so the screens aren't empty ----------
insert into public.wms_warehouses (code, name)
select 'JNB', 'Johannesburg Warehouse'
where not exists (select 1 from public.wms_warehouses);
