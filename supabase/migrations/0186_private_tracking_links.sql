-- ============================================================
-- 0186  Private Live Tracking links
-- ============================================================
-- The public track page (/track?ref=SEA614220) showed the customer's company,
-- the shipper and the customer's PO number to anyone who typed a shipment
-- number, and the numbers are guessable (prefix + 6 digits).
--
-- Now every shipment and quotation carries a random track_key, and the
-- Live Tracking link in Shipment / Quotation Comms emails includes it
-- (/track?ref=SEA614220&k=...). With the right key the page shows
-- everything as before; without it (a typed or guessed number) it still
-- shows status, route, ETA, map and movements, but not the customer,
-- shipper or PO number.
--
-- Links in emails sent BEFORE this have no key, so they now show the
-- shorter view. Run in the Supabase SQL editor after 0185. Idempotent.

-- Existing rows each get their own random key (volatile default, per row).
alter table public.jobs
  add column if not exists track_key text not null default replace(gen_random_uuid()::text, '-', '');
alter table public.quotes
  add column if not exists track_key text not null default replace(gen_random_uuid()::text, '-', '');

drop function if exists public.track_shipment(text);

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
