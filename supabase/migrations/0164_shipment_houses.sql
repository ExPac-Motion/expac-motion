-- ============================================================
-- 0164  Master shipments with houses (one quote, several HBL / HAWB)
-- ============================================================
-- A shipment (e.g. SEA160984, priced on one quote for 1.00 CBM) can carry
-- several houses, one per supplier: SEA160984-1, SEA160984-2 ... each with
-- its own shipper, pieces, weight, volume, commodity, value and the
-- carrier's HBL / HAWB number. The shipment number stays the one quote,
-- shipment and warehouse reference; the master's totals are its houses'.
--   * job_houses: the houses (house_no set automatically from the
--     shipment number + position).
--   * shipment_documents.house_id / wms_receipts.house_id: a document or
--     a warehouse receipt can belong to one house (null = the master).
--   * Portal: client_job_houses, and the customer uploads each house's
--     Commercial Invoice / Packing List / house bill against that house.
--
-- Run in the Supabase SQL editor after 0163. Self-contained & idempotent.

create table if not exists public.job_houses (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  position          int not null,
  house_no          text not null,
  supplier_id       uuid references public.suppliers (id) on delete set null,
  pieces            int not null default 0,
  gross_kg          numeric(12, 2) not null default 0,
  volume_cbm        numeric(12, 3) not null default 0,
  commodity         text,
  commercial_value  numeric(14, 2),
  value_currency    text,
  carrier_house_no  text,
  notes             text,
  created_at        timestamptz not null default now(),
  unique (job_id, position)
);
create index if not exists job_houses_job_idx on public.job_houses (job_id);

-- House number = shipment number + "-" + position, kept in step when the
-- shipment number changes.
create or replace function public.job_house_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.position is null or new.position < 1 then
    select coalesce(max(position), 0) + 1 into new.position from public.job_houses where job_id = new.job_id;
  end if;
  select j.reference || '-' || new.position into new.house_no from public.jobs j where j.id = new.job_id;
  return new;
end;
$$;
drop trigger if exists trg_job_house_number on public.job_houses;
create trigger trg_job_house_number before insert or update of position, job_id on public.job_houses
  for each row execute function public.job_house_number();

create or replace function public.job_houses_follow_reference()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.job_houses set house_no = new.reference || '-' || position where job_id = new.id;
  return null;
end;
$$;
drop trigger if exists trg_job_houses_follow_reference on public.jobs;
create trigger trg_job_houses_follow_reference after update of reference on public.jobs
  for each row when (old.reference is distinct from new.reference)
  execute function public.job_houses_follow_reference();

alter table public.job_houses enable row level security;
drop policy if exists "team full access" on public.job_houses;
create policy "team full access" on public.job_houses
  for all to authenticated using (public.can_see_accounts()) with check (public.can_see_accounts());

alter table public.shipment_documents
  add column if not exists house_id uuid references public.job_houses (id) on delete set null;
alter table public.wms_receipts
  add column if not exists house_id uuid references public.job_houses (id) on delete set null;

-- ---------- Portal ----------
create or replace view public.client_job_houses
with (security_barrier = true) as
select h.id, h.job_id, h.position, h.house_no, s.company as supplier_company,
       h.pieces, h.gross_kg, h.volume_cbm, h.commodity, h.commercial_value,
       h.value_currency, h.carrier_house_no
from public.job_houses h
join public.jobs j on j.id = h.job_id
left join public.suppliers s on s.id = h.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_job_houses to authenticated;

create or replace view public.client_documents
with (security_barrier = true) as
select sd.id, sd.job_id, sd.name, sd.storage_path, sd.kind, sd.doc_type,
       sd.size_bytes, sd.created_at, sd.from_client, sd.house_id
from public.shipment_documents sd
join public.jobs j on j.id = sd.job_id
where j.client_id = public.my_client_id() and sd.visible_to_client = true;
grant select on public.client_documents to authenticated;

-- The customer's upload, now optionally for one house.
drop function if exists public.portal_add_shipment_document(uuid, text, text, text, bigint);
create or replace function public.portal_add_shipment_document(
  p_job uuid, p_name text, p_path text, p_doc_type text, p_size bigint, p_house uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  v_id uuid;
  v_ref text;
  v_house text;
begin
  if cid is null then
    raise exception 'Only a customer portal login can upload here';
  end if;
  select reference into v_ref from public.jobs where id = p_job and client_id = cid;
  if v_ref is null then
    raise exception 'Shipment not found';
  end if;
  if p_house is not null then
    select house_no into v_house from public.job_houses where id = p_house and job_id = p_job;
    if v_house is null then
      raise exception 'House not found on this shipment';
    end if;
  end if;
  if p_doc_type not in ('Commercial Invoice', 'Packing List', 'HAWB', 'HBL') then
    raise exception 'Upload a Commercial Invoice, Packing List, HAWB or HBL here';
  end if;
  if p_path is null or p_path not like 'portal/' || p_job::text || '/%' then
    raise exception 'Upload the file to this shipment first';
  end if;
  insert into public.shipment_documents (job_id, name, storage_path, kind, doc_type, size_bytes,
                                         visible_to_client, from_client, house_id)
  values (p_job, coalesce(nullif(btrim(p_name), ''), 'Document'), p_path, 'upload', p_doc_type, p_size,
          true, true, p_house)
  returning id into v_id;

  insert into public.ops_tasks (kind, title, body, status, priority, job_id, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Customer uploaded ' || p_doc_type || ' on ' || coalesce(v_house, v_ref),
          'File: ' || coalesce(p_name, '') || '. Check it on the shipment''s documents.',
          'open', 'normal', p_job, cid, false, false, auth.uid());
  return v_id;
end;
$$;
grant execute on function public.portal_add_shipment_document(uuid, text, text, text, bigint, uuid) to authenticated;

notify pgrst, 'reload schema';
