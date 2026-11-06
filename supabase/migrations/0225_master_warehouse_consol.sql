-- ============================================================
-- 0225  Masters & houses, step 3: the warehouse consol is the master's
-- ============================================================
-- A Motion WMS consolidation (MAWB / MBL, 0137 / 0139) can belong to a
-- master shipment (0223) through wms_consols.job_id, so there is one master
-- record, not two:
--   * linking a consol to a shipment makes that shipment a Master;
--   * the master's house shipments are the consol's houses, kept in step:
--     a house put on the master joins its open consol (house number, shipper,
--     consignee, goods, pieces / kg / CBM on hand or declared, its receipts);
--     a house taken off or moved leaves it; a renumbered house follows;
--   * the master's MBL / MAWB, carrier, vessel, voyage and ETD / ETA and the
--     consol's are the same, whichever side is edited;
--   * the consol departing moves the master to Departed (0213), and the
--     master's status carries its houses (0224).
-- Consols with no master (several customers on one MBL) work as before.
--
-- Run in the Supabase SQL editor after 0224. Self-contained & idempotent.

-- One house shipment's row on its master's open consol: added, refreshed or removed.
create or replace function public.wms_consol_house_sync(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  c public.wms_consols%rowtype;
  q public.quotes%rowtype;
  rids uuid[];
  pcs numeric := 0;
  kg numeric := 0;
  cbm numeric := 0;
  r record;
  sup text;
  cons text;
begin
  select * into j from public.jobs where id = p_job;
  if not found then
    return;
  end if;
  if j.master_job_id is not null then
    select * into c from public.wms_consols
     where job_id = j.master_job_id and status <> 'departed'
     order by created_at limit 1;
  end if;

  -- Off any other master's open consol (moved or taken off).
  delete from public.wms_consol_houses h
   using public.wms_consols x
   where h.consol_id = x.id and h.job_id = p_job
     and x.job_id is not null and x.status <> 'departed'
     and x.id is distinct from c.id;

  if c.id is null then
    return;
  end if;
  if exists (select 1 from public.wms_consol_houses where consol_id = c.id and job_id = p_job) then
    update public.wms_consol_houses set house_no = j.house_no
     where consol_id = c.id and job_id = p_job and house_no is distinct from j.house_no;
    return;
  end if;

  -- Cargo: what is on hand in the warehouse for this shipment, else the quote's packing list.
  select array_agg(x.id) into rids from public.wms_receipts x where x.job_id = p_job;
  for r in
    select x.pieces, x.gross_kg, x.volume_cbm,
           greatest(coalesce((select sum(m.qty) from public.wms_stock_moves m where m.receipt_id = x.id), 0), 0) as on_hand
      from public.wms_receipts x where x.job_id = p_job
  loop
    if r.on_hand > 0 then
      pcs := pcs + r.on_hand;
      kg := kg + case when r.pieces > 0 then r.gross_kg * r.on_hand / r.pieces else 0 end;
      cbm := cbm + case when r.pieces > 0 then r.volume_cbm * r.on_hand / r.pieces else 0 end;
    end if;
  end loop;
  if pcs = 0 and j.quote_id is not null then
    select coalesce(sum(p.qty_ctns), 0),
           coalesce(sum(p.actual_kg * p.qty_ctns), 0),
           coalesce(sum(coalesce(p.cbm, p.length_cm * p.width_cm * p.height_cm / 1000000.0) * p.qty_ctns), 0)
      into pcs, kg, cbm
      from public.packing_list_items p where p.quote_id = j.quote_id;
  end if;
  if j.quote_id is not null then
    select * into q from public.quotes where id = j.quote_id;
  end if;
  select concat_ws(E'\n', s.company, s.address) into sup from public.suppliers s where s.id = j.supplier_id;
  select concat_ws(E'\n', k.company, k.address) into cons from public.clients k where k.id = j.client_id;

  insert into public.wms_consol_houses (
    consol_id, position, house_no, client_id, shipper, consignee, nature_of_goods,
    pieces, gross_kg, chargeable_kg, volume_cbm, receipt_ids, job_id
  ) values (
    c.id,
    coalesce((select max(position) + 1 from public.wms_consol_houses where consol_id = c.id), 0),
    j.house_no, j.client_id, nullif(sup, ''), nullif(cons, ''), nullif(q.commodity, ''),
    round(pcs)::int, round(kg, 2),
    round(greatest(kg, cbm * case when c.mode = 'air' then 167 else 1000 end), 2),
    round(cbm, 3), coalesce(rids, '{}'), p_job
  );
end;
$$;
grant execute on function public.wms_consol_house_sync(uuid) to authenticated;

create or replace function public.jobs_consol_house_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.master_job_id is null and new.master_job_id is null then
    return null;
  end if;
  perform public.wms_consol_house_sync(new.id);
  return null;
end;
$$;
drop trigger if exists trg_jobs_consol_house on public.jobs;
create trigger trg_jobs_consol_house
  after update of master_job_id, house_no, house_position on public.jobs
  for each row execute function public.jobs_consol_house_trg();

-- A consol linked to a shipment: that shipment is a Master, and its house
-- shipments join the consol.
create or replace function public.wms_consol_master_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  if new.job_id is null or (tg_op = 'UPDATE' and old.job_id is not distinct from new.job_id) then
    return null;
  end if;
  update public.jobs set shipment_kind = 'master'
   where id = new.job_id and shipment_kind = 'direct' and master_job_id is null;
  for hid in select id from public.jobs where master_job_id = new.job_id loop
    perform public.wms_consol_house_sync(hid);
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_wms_consol_master_link on public.wms_consols;
create trigger trg_wms_consol_master_link
  after insert or update of job_id on public.wms_consols
  for each row execute function public.wms_consol_master_link();

-- Master booking <-> consol: the same MBL / MAWB, carrier, vessel, voyage, ETD / ETA.
create or replace function public.jobs_master_to_consol()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  air boolean := coalesce(new.mode, '') like 'Air%' or coalesce(new.mode, '') like 'Courier%';
begin
  update public.wms_consols c set
    master_no   = new.awb_mbl,
    carrier     = coalesce(new.carrier_name, new.shipping_line, c.carrier),
    vessel      = case when air then c.vessel else new.vessel_name end,
    voyage_no   = case when air then c.voyage_no else new.voyage_no end,
    etd         = case when air then c.etd else new.etd end,
    flight_date = case when air then new.etd else c.flight_date end,
    eta         = new.eta
   where c.job_id = new.id and c.status <> 'departed'
     and (c.master_no, c.carrier, c.vessel, c.voyage_no, c.etd, c.flight_date, c.eta)
         is distinct from
         (new.awb_mbl, coalesce(new.carrier_name, new.shipping_line, c.carrier),
          case when air then c.vessel else new.vessel_name end,
          case when air then c.voyage_no else new.voyage_no end,
          case when air then c.etd else new.etd end,
          case when air then new.etd else c.flight_date end,
          new.eta);
  return null;
end;
$$;
drop trigger if exists trg_jobs_master_to_consol on public.jobs;
create trigger trg_jobs_master_to_consol
  after update of awb_mbl, carrier_name, shipping_line, vessel_name, voyage_no, etd, eta on public.jobs
  for each row execute function public.jobs_master_to_consol();

create or replace function public.wms_consol_to_master()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  air boolean := new.mode = 'air';
begin
  if new.job_id is null then
    return null;
  end if;
  update public.jobs j set
    awb_mbl      = coalesce(new.master_no, j.awb_mbl),
    carrier_name = coalesce(new.carrier, j.carrier_name),
    vessel_name  = case when air then j.vessel_name else coalesce(new.vessel, j.vessel_name) end,
    voyage_no    = case when air then j.voyage_no else coalesce(new.voyage_no, j.voyage_no) end,
    etd          = coalesce(case when air then new.flight_date else new.etd end, j.etd),
    eta          = coalesce(new.eta, j.eta)
   where j.id = new.job_id
     and (j.awb_mbl, j.carrier_name, j.vessel_name, j.voyage_no, j.etd, j.eta)
         is distinct from
         (coalesce(new.master_no, j.awb_mbl), coalesce(new.carrier, j.carrier_name),
          case when air then j.vessel_name else coalesce(new.vessel, j.vessel_name) end,
          case when air then j.voyage_no else coalesce(new.voyage_no, j.voyage_no) end,
          coalesce(case when air then new.flight_date else new.etd end, j.etd),
          coalesce(new.eta, j.eta));
  return null;
end;
$$;
drop trigger if exists trg_wms_consol_to_master on public.wms_consols;
create trigger trg_wms_consol_to_master
  after insert or update of job_id, master_no, carrier, vessel, voyage_no, etd, flight_date, eta on public.wms_consols
  for each row execute function public.wms_consol_to_master();

-- After the WMS screen saves a consol (it rewrites the house rows), put back
-- any of the master's house shipments that are missing.
create or replace function public.wms_consol_resync(p_consol uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  mid uuid;
  hid uuid;
begin
  select job_id into mid from public.wms_consols where id = p_consol and status <> 'departed';
  if mid is null then
    return;
  end if;
  for hid in select id from public.jobs where master_job_id = mid loop
    perform public.wms_consol_house_sync(hid);
  end loop;
end;
$$;
grant execute on function public.wms_consol_resync(uuid) to authenticated;
