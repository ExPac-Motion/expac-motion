-- ============================================================
-- 0222  Shipments with houses: book in one receipt per house
-- ============================================================
-- 0213 booked a shipment in automatically (at Collected / Arrived) as ONE
-- receipt for the whole shipment, from the quote's packing list. On a
-- master with houses (0164) that receipt held every house's cargo
-- (SEA332911: WR000145, 3 pcs = house -1's 1 pc + house -2's 2 pcs), and
-- putting it on one house moved both houses' cargo onto that house.
--
-- Now, for a shipment with houses:
--   * receive: a receipt booked by hand is still adopted; otherwise one
--     automatic receipt per house (house_id, the house's supplier, pieces,
--     kg and CBM, inbound ref = house number). The first carries the hub
--     link (one receipt per hub, 0213 unique index).
--   * release: everything still on hand for the shipment at that
--     warehouse goes out, every house's receipt, not only the hub's one.
--   * undo (status rolled back): every untouched automatic receipt of the
--     shipment at that warehouse is removed.
-- Shipments without houses work exactly as before.
--
-- Run in the Supabase SQL editor after 0221. Self-contained & idempotent.

-- True when nobody has touched an automatic receipt since it was booked in.
create or replace function public.wms_receipt_untouched(p_receipt uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.wms_stock_moves m where m.receipt_id = p_receipt and m.kind <> 'receipt')
     and not exists (select 1 from public.wms_receipts r where r.id = p_receipt and r.checked_at is not null)
     and not exists (select 1 from public.wms_consol_houses c where p_receipt = any (c.receipt_ids))
     and not exists (select 1 from public.wms_billing_runs b where b.lines::text like '%' || p_receipt::text || '%');
$$;

create or replace function public.wms_hub_receive(p_hub uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.job_hubs%rowtype;
  j public.jobs%rowtype;
  rid uuid;
  first_rid uuid;
  pkgs jsonb;
  pcs int;
  kg numeric;
  cbm numeric;
  goods text;
  hs record;
  status_note text;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'No access';
  end if;
  select * into h from public.job_hubs where id = p_hub;
  if not found then
    raise exception 'Shipment hub not found';
  end if;
  select id into rid from public.wms_receipts where job_hub_id = p_hub;
  if rid is not null then
    return rid;
  end if;
  select * into j from public.jobs where id = h.job_id;

  -- Already booked in by hand for this shipment at this warehouse: adopt it.
  select id into rid from public.wms_receipts
   where job_id = h.job_id and warehouse_id = h.warehouse_id and job_hub_id is null
   order by received_at
   limit 1;
  if rid is not null then
    update public.wms_receipts set job_hub_id = p_hub where id = rid;
    return rid;
  end if;

  select commodity into goods from public.quotes where id = j.quote_id;
  status_note := coalesce(' at status ' || nullif(btrim(j.shipment_status), ''), '');

  -- A master with houses: one receipt per house, from the house's figures.
  if exists (select 1 from public.job_houses where job_id = j.id) then
    for hs in select * from public.job_houses where job_id = j.id order by position loop
      insert into public.wms_receipts (
        warehouse_id, client_id, job_id, supplier_id, job_hub_id, house_id, auto_created, received_at,
        inbound_ref, customer_reference, description, package_type,
        pieces, gross_kg, volume_cbm, packages, notes
      ) values (
        h.warehouse_id, j.client_id, j.id, coalesce(hs.supplier_id, j.supplier_id),
        case when first_rid is null then p_hub end, hs.id, true, now(),
        hs.house_no, j.po_no, coalesce(nullif(btrim(hs.commodity), ''), goods),
        case when hs.pieces > 0 then 'Carton' end,
        greatest(coalesce(hs.pieces, 0), 0), coalesce(hs.gross_kg, 0), coalesce(hs.volume_cbm, 0), '[]'::jsonb,
        'Booked in automatically from shipment ' || j.reference || ', house ' || hs.house_no || status_note
          || case when coalesce(hs.pieces, 0) = 0 then '. No pieces on the house: count the goods and enter the pieces.' else '.' end
      ) returning id into rid;
      if coalesce(hs.pieces, 0) > 0 then
        delete from public.wms_stock_moves where receipt_id = rid and kind = 'receipt';
        insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
        values (rid, null, hs.pieces, 'receipt', rid, now());
      end if;
      first_rid := coalesce(first_rid, rid);
    end loop;
    return first_rid;
  end if;

  -- No houses: packages from the quote's packing list (kg and CBM are per carton there).
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', '',
           'description', coalesce(q.commodity, ''),
           'type', 'Carton',
           'qty', p.qty_ctns,
           'length_cm', p.length_cm,
           'width_cm', p.width_cm,
           'height_cm', p.height_cm,
           'actual_kg', p.actual_kg
         ) order by p.position), '[]'::jsonb),
         coalesce(round(sum(p.qty_ctns))::int, 0),
         coalesce(round(sum(p.actual_kg * p.qty_ctns), 2), 0),
         coalesce(round(sum(
           coalesce(p.cbm, p.length_cm * p.width_cm * p.height_cm / 1000000.0) * p.qty_ctns
         ), 3), 0)
    into pkgs, pcs, kg, cbm
    from public.packing_list_items p
    join public.quotes q on q.id = p.quote_id
   where p.quote_id = j.quote_id and p.qty_ctns > 0;

  insert into public.wms_receipts (
    warehouse_id, client_id, job_id, supplier_id, job_hub_id, auto_created, received_at,
    inbound_ref, customer_reference, description, package_type,
    pieces, gross_kg, volume_cbm, packages, notes
  ) values (
    h.warehouse_id, j.client_id, j.id, j.supplier_id, p_hub, true, now(),
    j.reference, j.po_no, goods, case when pcs > 0 then 'Carton' end,
    greatest(pcs, 0), kg, cbm, pkgs,
    'Booked in automatically from shipment ' || j.reference || status_note
      || case when pcs = 0 then '. No packing list on the quote: count the goods and enter the pieces.' else '.' end
  ) returning id into rid;
  if pcs > 0 then
    delete from public.wms_stock_moves where receipt_id = rid and kind = 'receipt';
    insert into public.wms_stock_moves (receipt_id, location_id, qty, kind, ref_id, at)
    values (rid, null, pcs, 'receipt', rid, now());
  end if;
  return rid;
end;
$$;
grant execute on function public.wms_hub_receive(uuid) to authenticated;

create or replace function public.wms_hub_release(p_hub uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  h public.job_hubs%rowtype;
  j public.jobs%rowtype;
  r public.wms_receipts%rowtype;
  rel uuid;
  l record;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'No access';
  end if;
  select * into h from public.job_hubs where id = p_hub;
  if not found then
    raise exception 'Shipment hub not found';
  end if;
  select * into j from public.jobs where id = h.job_id;
  select * into r from public.wms_receipts where id = public.wms_hub_receive(p_hub);

  -- On hand per receipt and bay, for every receipt of the shipment at this
  -- warehouse (one per house on a master) = ledger, less release lines whose
  -- ledger row hasn't been posted yet (same pass, see wms_hub_receive).
  create temp table if not exists wms_hub_avail (receipt_id uuid, location_id uuid, pcs int) on commit drop;
  delete from wms_hub_avail;
  insert into wms_hub_avail
  select rid, loc, sum(q)::int from (
    select m.receipt_id as rid, m.location_id as loc, m.qty as q
      from public.wms_stock_moves m
      join public.wms_receipts x on x.id = m.receipt_id
     where x.id = r.id or (x.job_id = j.id and x.warehouse_id = h.warehouse_id)
    union all
    select rl.receipt_id, rl.location_id, -rl.pieces
      from public.wms_release_lines rl
      join public.wms_receipts x on x.id = rl.receipt_id
     where (x.id = r.id or (x.job_id = j.id and x.warehouse_id = h.warehouse_id))
       and not exists (select 1 from public.wms_stock_moves m where m.ref_id = rl.id and m.kind = 'release')
  ) t group by rid, loc having sum(q) > 0;

  -- Nothing left on hand (already released by hand, or no pieces): done.
  if not exists (select 1 from wms_hub_avail) then
    return null;
  end if;

  insert into public.wms_releases (
    warehouse_id, client_id, job_id, job_hub_id, auto_created, released_at, outbound_ref, notes
  ) values (
    h.warehouse_id, coalesce(r.client_id, j.client_id), j.id, p_hub, true, now(), j.awb_mbl,
    'Released automatically from shipment ' || j.reference
      || coalesce(' at status ' || nullif(btrim(j.shipment_status), ''), '') || '.'
  ) returning id into rel;

  for l in
    select a.receipt_id, a.location_id, a.pcs, x.pieces, x.gross_kg, x.volume_cbm
      from wms_hub_avail a join public.wms_receipts x on x.id = a.receipt_id
  loop
    insert into public.wms_release_lines (release_id, receipt_id, location_id, pieces, gross_kg, volume_cbm)
    values (
      rel, l.receipt_id, l.location_id, l.pcs,
      case when l.pieces > 0 then round(l.gross_kg * l.pcs / l.pieces, 2) else 0 end,
      case when l.pieces > 0 then round(l.volume_cbm * l.pcs / l.pieces, 3) else 0 end
    );
  end loop;
  return rel;
end;
$$;
grant execute on function public.wms_hub_release(uuid) to authenticated;

-- Status rolled back: undo what this hub did automatically, if nobody has
-- touched it since. p_receipt = false undoes only the release.
create or replace function public.wms_hub_undo(p_hub uuid, p_receipt boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  h public.job_hubs%rowtype;
  x record;
begin
  -- Automatic releases without a POD.
  delete from public.wms_releases rl
   where rl.job_hub_id = p_hub and rl.auto_created
     and rl.pod_signed_by is null and rl.pod_delivered_at is null
     and coalesce(rl.pod_path, '') = '';
  if not p_receipt then
    return;
  end if;
  select * into h from public.job_hubs where id = p_hub;
  if not found then
    return;
  end if;
  -- The hub's automatic receipt, plus (on a master) every house's one.
  for x in
    select r.id from public.wms_receipts r
     where r.auto_created
       and (r.job_hub_id = p_hub
            or (r.job_id = h.job_id and r.warehouse_id = h.warehouse_id and r.house_id is not null and r.job_hub_id is null))
  loop
    if public.wms_receipt_untouched(x.id) then
      delete from public.wms_receipts where id = x.id; -- touched ones stay, the sync check flags them
    end if;
  end loop;
end;
$$;
