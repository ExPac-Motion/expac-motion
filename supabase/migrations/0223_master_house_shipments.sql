-- ============================================================
-- 0223  Shipments as Direct, Master or House (step 1)
-- ============================================================
-- Every shipment starts Direct. When the same consignee has several
-- shipments, they become Houses on a Master (user, 2026-11-06):
--   * the Master is a shipment of its own (often the first one, e.g.
--     SEA161005); it keeps its number system wide and is what the customer
--     is billed on. Its pieces / kg / CBM are its houses' (the app adds
--     them up, received figures once the goods are checked in).
--   * a House stays a full shipment (commercial invoice, packing list,
--     house bill, status, documents). Its house number comes from the
--     master: HBL161005-1, -2 ... (sea) or HAWB161005-1 ... (air). That is
--     also its house bill number. Its own shipment number stays as a
--     reference; a house moved to another master is renumbered.
--   * the master's booking (vessel, voyage, container, MBL / MAWB, carrier,
--     ETD / ETA) flows down to its houses.
--   * a house is for the same customer as its master; a house can't have
--     houses of its own, and a master can't be a house.
--
-- Columns on jobs: shipment_kind ('direct' | 'master' | 'house'),
-- master_job_id, house_no, house_position.
-- Shipments that already have supplier houses (job_houses, 0164) are
-- marked Master. Step 2 moves those supplier houses over.
--
-- Run in the Supabase SQL editor after 0222. Self-contained & idempotent.

alter table public.jobs
  add column if not exists shipment_kind text not null default 'direct',
  add column if not exists master_job_id uuid references public.jobs (id) on delete set null,
  add column if not exists house_no text,
  add column if not exists house_position int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_shipment_kind_chk') then
    alter table public.jobs
      add constraint jobs_shipment_kind_chk check (shipment_kind in ('direct', 'master', 'house'));
  end if;
end;
$$;
create index if not exists jobs_master_job_idx on public.jobs (master_job_id) where master_job_id is not null;

-- "SEA161005" + air / sea + 2 -> "HBL161005-2" / "HAWB161005-2".
create or replace function public.house_number_for(p_master_ref text, p_mode text, p_pos int)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_mode, '') like 'Air%' or coalesce(p_mode, '') like 'Courier%' then 'HAWB' else 'HBL' end
         || coalesce(nullif(regexp_replace(coalesce(p_master_ref, ''), '^[A-Za-z]+', ''), ''), coalesce(p_master_ref, ''))
         || '-' || p_pos;
$$;

-- Before insert / update: checks, house number, the master's booking.
create or replace function public.jobs_master_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m public.jobs%rowtype;
begin
  if new.master_job_id is null then
    if new.shipment_kind = 'direct' and tg_op = 'UPDATE' and exists (select 1 from public.jobs where master_job_id = new.id) then
      raise exception '% still has houses: take them off first', new.reference;
    end if;
    if new.shipment_kind = 'house' then
      new.shipment_kind := 'direct';
    end if;
    new.house_no := null;
    new.house_position := null;
    return new;
  end if;

  if new.master_job_id = new.id then
    raise exception 'A shipment can''t be its own master';
  end if;
  select * into m from public.jobs where id = new.master_job_id;
  if not found then
    raise exception 'Master shipment not found';
  end if;
  if m.master_job_id is not null then
    raise exception '% is a house itself, pick its master instead', coalesce(m.house_no, m.reference);
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from public.jobs where master_job_id = new.id) then
    raise exception '% is a master with houses, it can''t be a house too', new.reference;
  end if;
  if m.client_id is distinct from new.client_id then
    raise exception 'A house must be for the same customer as its master (%)', m.reference;
  end if;

  if tg_op = 'INSERT' or old.master_job_id is distinct from new.master_job_id or new.house_position is null then
    select coalesce(max(house_position), 0) + 1 into new.house_position
      from public.jobs where master_job_id = new.master_job_id and id <> new.id;
  end if;
  new.shipment_kind := 'house';
  new.house_no := public.house_number_for(m.reference, m.mode, new.house_position);

  -- Joining a master: take its booking where the master has it.
  if tg_op = 'INSERT' or old.master_job_id is distinct from new.master_job_id then
    new.vessel_name    := coalesce(m.vessel_name, new.vessel_name);
    new.voyage_no      := coalesce(m.voyage_no, new.voyage_no);
    new.vessel_mmsi    := coalesce(m.vessel_mmsi, new.vessel_mmsi);
    new.container_no   := coalesce(m.container_no, new.container_no);
    new.container_type := coalesce(m.container_type, new.container_type);
    new.shipping_line  := coalesce(m.shipping_line, new.shipping_line);
    new.carrier_name   := coalesce(m.carrier_name, new.carrier_name);
    new.scac           := coalesce(m.scac, new.scac);
    new.awb_mbl        := coalesce(m.awb_mbl, new.awb_mbl);
    new.etd            := coalesce(m.etd, new.etd);
    new.eta            := coalesce(m.eta, new.eta);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_jobs_master_link on public.jobs;
create trigger trg_jobs_master_link
  before insert or update of master_job_id, shipment_kind, client_id on public.jobs
  for each row execute function public.jobs_master_link();

-- After: the master is marked Master; a master that lost its last house
-- goes back to Direct (unless it still has supplier houses); the house's
-- quote carries the house bill number.
create or replace function public.jobs_master_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.master_job_id is not null then
    update public.jobs set shipment_kind = 'master'
     where id = new.master_job_id and shipment_kind <> 'master';
  end if;
  if tg_op = 'UPDATE' and old.master_job_id is not null and old.master_job_id is distinct from new.master_job_id then
    update public.jobs j set shipment_kind = 'direct'
     where j.id = old.master_job_id and j.shipment_kind = 'master'
       and not exists (select 1 from public.jobs h where h.master_job_id = j.id)
       and not exists (select 1 from public.job_houses x where x.job_id = j.id);
    -- Close the gap in the old master's house numbers.
    update public.jobs h set house_position = s.rn
      from (select id, row_number() over (order by house_position, created_at) as rn
              from public.jobs where master_job_id = old.master_job_id) s
     where h.id = s.id and h.house_position is distinct from s.rn;
  end if;
  if new.quote_id is not null and new.house_no is not null and new.house_no is distinct from (case when tg_op = 'UPDATE' then old.house_no end) then
    update public.quotes q
       set hbl_no = case when coalesce(new.mode, '') like 'Air%' or coalesce(new.mode, '') like 'Courier%' then q.hbl_no
                         else new.house_no end,
           hawb_no = case when coalesce(new.mode, '') like 'Air%' or coalesce(new.mode, '') like 'Courier%' then new.house_no
                          else q.hawb_no end
     where q.id = new.quote_id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_jobs_master_after on public.jobs;
create trigger trg_jobs_master_after
  after insert or update of master_job_id, house_no, house_position on public.jobs
  for each row execute function public.jobs_master_after();

-- The master's booking, number and mode flow down to its houses.
create or replace function public.jobs_master_flow_down()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.jobs where master_job_id = new.id) then
    return null;
  end if;
  update public.jobs h set
    vessel_name    = new.vessel_name,
    voyage_no      = new.voyage_no,
    vessel_mmsi    = new.vessel_mmsi,
    container_no   = new.container_no,
    container_type = new.container_type,
    shipping_line  = new.shipping_line,
    carrier_name   = new.carrier_name,
    scac           = new.scac,
    awb_mbl        = new.awb_mbl,
    etd            = new.etd,
    eta            = new.eta
   where h.master_job_id = new.id
     and (h.vessel_name, h.voyage_no, h.vessel_mmsi, h.container_no, h.container_type, h.shipping_line,
          h.carrier_name, h.scac, h.awb_mbl, h.etd, h.eta)
         is distinct from
         (new.vessel_name, new.voyage_no, new.vessel_mmsi, new.container_no, new.container_type, new.shipping_line,
          new.carrier_name, new.scac, new.awb_mbl, new.etd, new.eta);
  if tg_op = 'UPDATE' and (new.reference is distinct from old.reference or new.mode is distinct from old.mode) then
    update public.jobs h set house_no = public.house_number_for(new.reference, new.mode, h.house_position)
     where h.master_job_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_jobs_master_flow_down on public.jobs;
create trigger trg_jobs_master_flow_down
  after update of vessel_name, voyage_no, vessel_mmsi, container_no, container_type, shipping_line,
                  carrier_name, scac, awb_mbl, etd, eta, reference, mode on public.jobs
  for each row execute function public.jobs_master_flow_down();

-- A house's position changed (gap closed): renumber it.
create or replace function public.jobs_house_renumber()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.master_job_id is not null then
    new.house_no := public.house_number_for(
      (select reference from public.jobs where id = new.master_job_id),
      (select mode from public.jobs where id = new.master_job_id),
      new.house_position);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_jobs_house_renumber on public.jobs;
create trigger trg_jobs_house_renumber
  before update of house_position on public.jobs
  for each row when (new.house_position is distinct from old.house_position)
  execute function public.jobs_house_renumber();

-- Shipments with supplier houses today are masters.
update public.jobs j set shipment_kind = 'master'
 where j.shipment_kind = 'direct'
   and exists (select 1 from public.job_houses h where h.job_id = j.id);
