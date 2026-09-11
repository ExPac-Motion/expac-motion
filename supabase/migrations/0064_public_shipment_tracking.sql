-- ============================================================
-- 0064  Public shipment tracking lookup (no login required)
-- ============================================================
-- Lets a customer look up their shipment by our shipment number (e.g.
-- SEA170869) with no portal login -- the public equivalent of the portal's
-- Live Tracking panel, for the expac.co.za/live-tracking page (which
-- currently just embeds a generic ShipsGo widget that has no idea what our
-- shipment numbers are, so a customer searching one there always comes back
-- empty).
--
-- Exposes only non-sensitive operational fields (no buy/margin, no contact
-- emails/phones, no other customers' data) -- the same class of exposure as
-- any carrier's own public tracking page. Exact reference match only.
--
-- Run in the Supabase SQL editor after 0063. Self-contained & idempotent.

create or replace function public.track_shipment(p_reference text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
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
  where upper(j.reference) = upper(trim(p_reference))
  limit 1;
$$;

grant execute on function public.track_shipment(text) to anon, authenticated;
