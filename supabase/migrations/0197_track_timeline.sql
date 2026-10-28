-- ============================================================
-- 0197  Public tracking: the shipment timeline
-- ============================================================
-- The /track page (track_shipment) now also returns the shipment's
-- timeline (0196): customer-visible steps only, the actual date once a
-- step is done, and the planned date only for Departed / Arrived /
-- Delivered (ETD / ETA / PDD, which the page already shows). Same rules
-- as the portal's client_job_timeline. No names, notes or internal steps.
--
-- Run in the Supabase SQL editor after 0196. Self-contained & idempotent
-- (CREATE OR REPLACE, signature unchanged from 0186).

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
