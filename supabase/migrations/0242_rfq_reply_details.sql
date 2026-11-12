-- ============================================================
-- 0242  RFQ reply form: same details as the RFQ PDF
-- ============================================================
-- rfq_reply_get (0241) also returns the quote's delivery terms (door to door,
-- port to door ...), the RFQ's issue date and the partner type, so the
-- agent's reply form shows exactly what the PDF shows.
--
-- Run in the Supabase SQL editor after 0241. Self-contained & idempotent.

create or replace function public.rfq_reply_get(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'rfq_number', 'RFQ-' || q.reference,
    'reference', q.reference,
    'rfq_date', f.created_at,
    'partner_kind', f.partner_kind,
    'mode', q.mode,
    'origin', q.origin,
    'destination', q.destination,
    'incoterms', q.incoterms,
    'delivery_terms', q.delivery_terms,
    'commodity', q.commodity,
    'ready_date', q.request_ready_date,
    'etd', q.etd,
    'container_type', q.container_type,
    'pickup', q.request_pickup,
    'reply_by', f.reply_by,
    'notes', f.notes,
    'charges', f.charges,
    'company', r.company,
    'status', r.status,
    'responded_at', r.responded_at,
    'validity', r.validity,
    'transit_time', r.transit_time,
    'remarks', r.remarks,
    'packing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'length_cm', p.length_cm, 'width_cm', p.width_cm, 'height_cm', p.height_cm,
        'actual_kg', p.actual_kg, 'qty_ctns', p.qty_ctns, 'qty_pcs', p.qty_pcs, 'cbm', p.cbm
      ) order by p.position)
      from public.packing_list_items p where p.quote_id = q.id
    ), '[]'::jsonb),
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', x.category, 'code', x.code, 'description', x.description,
        'unit', x.unit, 'cur', x.cur, 'rate', x.rate, 'min_charge', x.min_charge,
        'remarks', x.remarks
      ) order by x.position)
      from public.quote_rfq_rates x where x.recipient_id = r.id
    ), '[]'::jsonb)
  )
  from public.quote_rfq_recipients r
  join public.quote_rfqs f on f.id = r.rfq_id
  join public.quotes q on q.id = r.quote_id
  where r.token = p_token
$$;
revoke execute on function public.rfq_reply_get(uuid) from public;
grant execute on function public.rfq_reply_get(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
