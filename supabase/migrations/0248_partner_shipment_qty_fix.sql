-- ============================================================
-- 0248  Partner Portal: opening a shipment failed with
--       "COALESCE types boolean and numeric cannot be matched".
-- ============================================================
-- partner_shipment() (0243) read the charge quantity as
-- coalesce(l.qty_override, l.qty), but quote_lines.qty_override is the
-- boolean "quantity was typed by hand" flag (0045), not a number; l.qty
-- already holds the quantity either way. Any shipment with buy lines for
-- the partner failed to open. Re-emitted unchanged apart from that line.
--
-- Run in the Supabase SQL editor after 0247. Self-contained & idempotent.

create or replace function public.partner_shipment(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  j public.jobs%rowtype;
  q public.quotes%rowtype;
  qid uuid;
  sup public.suppliers%rowtype;
  con public.clients%rowtype;
  cf public.customs_files%rowtype;
  res jsonb;
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  select * into j from public.jobs where id = p_job;
  -- A house without its own quote reads the master's.
  qid := coalesce(j.quote_id, (select m.quote_id from public.jobs m where m.id = j.master_job_id));
  select * into q from public.quotes where id = qid;
  select * into cf from public.customs_files where job_id = coalesce(j.master_job_id, j.id) order by created_at desc limit 1;

  res := jsonb_build_object(
    'id', j.id,
    'partner_kind', k,
    'reference', j.reference,
    'shipment_kind', j.shipment_kind,
    'master_reference', (select m.reference from public.jobs m where m.id = j.master_job_id),
    'mode', j.mode,
    'origin', j.origin,
    'destination', j.destination,
    'incoterms', q.incoterms,
    'delivery_terms', q.delivery_terms,
    'commodity', q.commodity,
    'container_type', coalesce(j.container_type, q.container_type),
    'shipment_status', j.shipment_status,
    'ready_date', q.request_ready_date,
    'etd', j.etd,
    'eta', j.eta,
    'delivery_date', j.provisional_delivery_date,
    'carrier_name', j.carrier_name,
    'shipping_line', j.shipping_line,
    'vessel_name', j.vessel_name,
    'voyage_no', j.voyage_no,
    'awb_mbl', j.awb_mbl,
    'container_no', j.container_no,
    'seal_no', j.seal_no,
    'pod_signed_by', j.pod_signed_by,
    'pod_delivered_at', j.pod_delivered_at,
    'completed', j.ops_completed_at is not null or btrim(coalesce(j.shipment_status, '')) = 'Delivered',
    'notes', q.request_notes
  );

  -- Transporters see the dates and the release, not the booking details.
  if k = 'transporter' then
    res := res - 'carrier_name' - 'shipping_line' - 'vessel_name' - 'voyage_no' - 'awb_mbl' - 'seal_no';
  end if;

  -- Customs stage for those who need it.
  if k in ('clearing_agent', 'destination_agent', 'transporter') and cf.id is not null then
    res := res || jsonb_build_object(
      'customs_stage', cf.stage,
      'customs_released', cf.stage = 'cleared' or btrim(coalesce(j.shipment_status, '')) in ('Released', 'On-Delivery', 'Delivered'),
      'entry_no', case when k = 'transporter' then null else cf.entry_no end);
  end if;

  -- Origin agent: the shipper and the pickup address.
  if k = 'agent' then
    select * into sup from public.suppliers where id = coalesce(j.supplier_id, q.supplier_id);
    res := res || jsonb_build_object('pickup', jsonb_build_object(
      'company', sup.company,
      'address', coalesce(nullif(btrim(coalesce(q.request_pickup, '')), ''), sup.address),
      'contact', sup.contact, 'phone', sup.phone, 'email', sup.email));
  end if;

  -- Delivery side: the address and the on-site contact, never the company.
  if k in ('transporter', 'destination_agent', 'clearing_agent') then
    select * into con from public.clients where id = q.consignee_id;
    res := res || jsonb_build_object('delivery', jsonb_build_object(
      'address', coalesce(nullif(btrim(coalesce(q.request_delivery, '')), ''), con.address),
      'contact', con.contact, 'phone', con.phone));
  end if;

  res := res || jsonb_build_object(
    'packing', coalesce((
      select jsonb_agg(jsonb_build_object('length_cm', pk.length_cm, 'width_cm', pk.width_cm, 'height_cm', pk.height_cm,
                                          'actual_kg', pk.actual_kg, 'qty_pcs', pk.qty_pcs, 'qty_ctns', pk.qty_ctns, 'cbm', pk.cbm)
                       order by pk.position)
        from public.packing_list_items pk where pk.quote_id = qid), '[]'::jsonb),

    -- Their own buy lines (in the line's currency), as on our rate sheet to them.
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object('category', l.category, 'code', l.code, 'description', l.description,
                                          'unit', l.unit, 'cur', l.cur, 'rate', l.buy,
                                          'qty', l.qty)
                       order by l.position)
        from public.quote_lines l
       where l.quote_id = qid and coalesce(l.buy, 0) > 0
         and case
               when l.category = 'Destination Handling and Delivery Charges' and coalesce(l.code, '') ~ '^(TR|WH)-' then 'transporter'
               when l.category in ('International Freight Charges', 'Ex-Works Charges', 'FOB Charges') then 'agent'
               when l.category = 'Destination Handling and Delivery Charges' then 'destination_agent'
               when l.category = 'Customs Clearance, VAT and Duty Charges' then 'clearing_agent'
             end = k), '[]'::jsonb),

    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'doc_type', d.doc_type, 'storage_path', d.storage_path,
                                          'size_bytes', d.size_bytes, 'created_at', d.created_at,
                                          'mine', d.from_partner_id = p)
                       order by d.created_at)
        from public.shipment_documents d
       where d.job_id in (j.id, j.master_job_id)
         and public.partner_can_open(d.storage_path)), '[]'::jsonb),

    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('step', t.step, 'done', t.done, 'planned_date', t.planned_date,
                                          'actual_date', t.actual_date)
                       order by t.sort_order)
        from public.job_timeline_steps t
       where t.job_id = j.id and not t.skipped), '[]'::jsonb),

    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'body', m.body, 'created_at', m.created_at)
                       order by m.created_at)
        from public.job_partner_messages m
       where m.job_id = j.id and m.partner_id = p), '[]'::jsonb),

    'tracking', (
      select jsonb_build_object('vessel_name', t.vessel_name, 'voyage', t.voyage, 'status', t.tracking_status,
                                'vessel_lat', t.vessel_lat, 'vessel_lon', t.vessel_lon, 'position_at', t.position_at,
                                'speed_kn', t.speed_kn, 'pol_lat', t.pol_lat, 'pol_lon', t.pol_lon,
                                'pod_lat', t.pod_lat, 'pod_lon', t.pod_lon, 'route_path', t.route_path,
                                'pol', t.pol, 'pod', t.pod, 'eta', t.eta, 'synced_at', t.synced_at,
                                'atd', t.atd, 'etd', coalesce(t.etd, j.etd), 'pod_ata', t.pod_ata, 'pod_eta', t.pod_eta)
        from public.job_tracking t
       where t.job_id = coalesce(j.master_job_id, j.id)
       order by t.synced_at desc nulls last limit 1),

    'history', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.changed_at, 'status', h.status) order by h.changed_at desc)
        from public.job_status_history h where h.job_id = j.id), '[]'::jsonb)
  );
  return res;
end;
$$;
revoke execute on function public.partner_shipment(uuid) from public, anon;
grant execute on function public.partner_shipment(uuid) to authenticated;

