-- 0240: shipment hubs release out of the warehouse again when the shipment
-- Departs (or reaches On-Delivery) from the app.
--
-- wms_hub_release emptied its scratch table with a bare "delete from
-- wms_hub_avail;". Supabase runs every API call with pg-safeupdate, which
-- refuses a DELETE without a WHERE clause, so the release failed whenever a
-- status change came from the app (wms_apply_job_hubs swallows the error so
-- the status still saves). From the SQL editor (no safeupdate) it worked,
-- which is why replays passed. Same fix as 0229: TRUNCATE instead.
-- Then releases any shipment hub still holding stock it should have let go
-- (e.g. WR000133 / SEA126049 in the CN hub).

CREATE OR REPLACE FUNCTION public.wms_hub_release(p_hub uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  truncate wms_hub_avail; -- not a bare DELETE: API calls run with pg-safeupdate, which refuses it
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
$function$;

do $$
declare
  s record;
begin
  for s in
    select v.hub_id from public.wms_hub_sync v
     cross join lateral public.job_hub_expect(v.hub_id) e
     where e.want_out and v.on_hand > 0
  loop
    perform public.wms_hub_release(s.hub_id);
  end loop;
end;
$$;
