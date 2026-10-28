-- ============================================================
-- 0202  Live tracking: the real sea / air route on the map
-- ============================================================
-- ShipsGo's route endpoint (GET /ocean|air/shipments/{id}/geojson, free,
-- no credits) gives the path the vessel / flight actually takes, sailed and
-- still to go, plus its current position. The webhook and the Refresh
-- button store a slimmed copy on job_tracking.route_path:
--   [{ "s": "PAST|CURRENT|FUTURE", "c": [[lat, lon], ...],
--      "at": [lat, lon] | null, "i": index | null }]
-- (coordinates only: no vessel names, no events). The Motion, portal and
-- /track maps draw it instead of a straight line.
--
--   1. job_tracking.route_path + route_synced_at
--   2. client_job_tracking (portal) exposes route_path
--   3. track_shipment (/track) returns route_path (otherwise as 0197)
--
-- Run in the Supabase SQL editor after 0201. Self-contained & idempotent.

alter table public.job_tracking
  add column if not exists route_path      jsonb,
  add column if not exists route_synced_at timestamptz;

create or replace view public.client_job_tracking
with (security_barrier = true) as
select t.job_id, t.status, t.carrier, t.pol, t.pod, t.etd, t.eta,
       t.pod_eta, t.pod_ata, t.last_event, t.vessel_name, t.voyage,
       t.pol_lat, t.pol_lon, t.pod_lat, t.pod_lon,
       t.vessel_lat, t.vessel_lon, t.position_at, t.synced_at,
       t.route_path
from public.job_tracking t
join public.jobs j on j.id = t.job_id
where j.client_id = public.my_client_id();

create or replace function public.track_shipment(p_reference text, p_key text default null)
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
  ),
  j as (
    select j.*,
      -- The shipment's own key, or its quotation's (quote emails link before
      -- the shipment exists).
      coalesce(nullif(trim(p_key), ''), '') <> ''
        and (trim(p_key) = j.track_key
             or exists (select 1 from public.quotes q where q.id = j.quote_id and q.track_key = trim(p_key)))
        as full_view
    from public.jobs j
    where upper(j.reference) = upper(trim(p_reference))
    limit 1
  )
  select jsonb_build_object(
    'reference', j.reference,
    'mode', j.mode,
    'full_view', j.full_view,
    'customer', case when j.full_view then c.company end,
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
    'route_path', t.route_path,
    'etd', coalesce(t.etd::text, j.etd::text),
    'eta', coalesce(t.pod_eta::date::text, t.eta::text, j.eta::text),
    'last_event', t.last_event,
    'shipper', case when j.full_view then s.company end,
    'customer_ref', case when j.full_view then j.po_no end,
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
    ), '[]'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'step', st.step,
        'done', st.done,
        'actual_date', case when st.done then st.actual_date::text end,
        'planned_date', case when st.step in ('Departed', 'Arrived', 'Delivered') then st.planned_date::text end
      ) order by st.sort_order)
      from public.job_timeline_steps st
      where st.job_id = j.id and st.customer_visible and not st.skipped
    ), '[]'::jsonb)
  )
  from j
  left join public.job_tracking t on t.job_id = j.id
  left join public.clients c on c.id = j.client_id
  left join public.suppliers s on s.id = j.supplier_id
  left join pack pk on pk.quote_id = j.quote_id;
$$;

revoke execute on function public.track_shipment(text, text) from public;
grant execute on function public.track_shipment(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
