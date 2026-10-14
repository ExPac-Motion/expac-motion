-- ============================================================
-- 0173  Portal + public tracking: airport / port code on each event
-- ============================================================
-- The new route map + Movements list (src/components/TrackMovements.tsx)
-- shows "CAN Guangzhou Baiyun International Airport" in Motion, but the
-- customer portal (client_tracking_events) and the public /track page
-- (track_shipment) never exposed tracking_events.locode, so customers saw
-- the name only. Adds locode to both; nothing else changes.
--
-- Run in the Supabase SQL editor after 0172. Self-contained & idempotent.

-- New column goes last (create or replace view can only append).
create or replace view public.client_tracking_events
with (security_barrier = true) as
select e.id, e.job_id, e.event_code, e.description, e.location,
       e.lat, e.lon, e.vessel_name, e.voyage, e.occurred_at, e.is_actual,
       e.locode
from public.tracking_events e
join public.jobs j on j.id = e.job_id
where j.client_id = public.my_client_id();

grant select on public.client_tracking_events to authenticated;

-- track_shipment as in 0065, plus 'locode' on each event.
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
        'locode', e.locode,
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
