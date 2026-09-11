-- ============================================================
-- 0065  Public tracking page: add shipper / reference / PDD / cargo details
-- ============================================================
-- Adds the customer-facing shipment summary fields requested for the public
-- /track page: Shipper Name, Reference (customer PO), PDD (provisional
-- delivery date), Qty (cartons), Chargeable Weight (kg) and Total Volume
-- (CBM) -- the same MAX(actual, volumetric) chargeable-weight math used by
-- the quote builder's packing list (see src/lib/calc.ts packingTotals()).
--
-- Run in the Supabase SQL editor after 0064. Self-contained & idempotent.

create or replace function public.track_shipment(p_reference text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with pack as (
    select
      p.quote_id,
      sum(p.qty_ctns) as qty,
      sum(p.actual_kg * p.qty_ctns) as total_actual_kg,
      sum(coalesce(p.cbm, (p.length_cm * p.width_cm * p.height_cm) / 1000000.0) * p.qty_ctns) as total_cbm
    from public.packing_list_items p
    group by p.quote_id
  )
  select jsonb_build_object(
    'reference', j.reference,
    'mode', j.mode,
    'customer', c.company,
    'status', coalesce(t.status, j.shipment_status, j.milestone),
    'carrier', coalesce(t.carrier, j.carrier_name),
    'vessel_name', coalesce(t.vessel_name, j.vessel_name),
    'voyage', t.voyage,
    'pol', coalesce(t.pol, j.origin),
    'pod', coalesce(t.pod, j.destination),
    'pol_lat', t.pol_lat, 'pol_lon', t.pol_lon,
    'pod_lat', t.pod_lat, 'pod_lon', t.pod_lon,
    'vessel_lat', t.vessel_lat, 'vessel_lon', t.vessel_lon,
    'position_at', t.position_at,
    'etd', coalesce(t.etd::text, j.etd::text),
    'eta', coalesce(t.pod_eta::date::text, t.eta::text, j.eta::text),
    'last_event', t.last_event,
    'shipper', s.company,
    'customer_ref', j.po_no,
    'pdd', j.provisional_delivery_date::text,
    'qty', pk.qty,
    'cw_kg', case when pk.quote_id is null then null else greatest(
      coalesce(pk.total_actual_kg, 0),
      coalesce(pk.total_cbm, 0) * case when j.mode = 'Sea Freight (LCL)' then 1000 else 167 end
    ) end,
    'ttl_vol', pk.total_cbm,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_code', e.event_code,
        'description', e.description,
        'location', e.location,
        'lat', e.lat, 'lon', e.lon,
        'vessel_name', e.vessel_name,
        'voyage', e.voyage,
        'occurred_at', e.occurred_at,
        'is_actual', e.is_actual
      ) order by e.occurred_at)
      from public.tracking_events e
      where e.job_id = j.id
    ), '[]'::jsonb)
  )
  from public.jobs j
  left join public.job_tracking t on t.job_id = j.id
  left join public.clients c on c.id = j.client_id
  left join public.suppliers s on s.id = j.supplier_id
  left join pack pk on pk.quote_id = j.quote_id
  where upper(j.reference) = upper(trim(p_reference))
  limit 1;
$$;

grant execute on function public.track_shipment(text) to anon, authenticated;
