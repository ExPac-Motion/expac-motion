-- ============================================================
-- 0175  New mode: Air Freight (Consol)
-- ============================================================
-- Consolidated air freight becomes its own mode next to Air Freight (AIR),
-- on quotes and shipments, the Quote Builder, the customer portal's
-- Request a Quote and the website quote request forms. It is an air mode
-- everywhere else (AIR... reference, air volumetric weight, HAWB / MAWB,
-- airline tracking), the app treats every "Air Freight ..." mode as air.
--
--   1. quotes / jobs mode CHECK constraints allow it.
--   2. portal_request_quote() (0149) accepts it.
--   3. web_form_quote_mode() (0172): "consol" answers -> Air Freight (Consol).
--
-- Run in the Supabase SQL editor after 0174. Self-contained & idempotent.

alter table public.quotes drop constraint if exists quotes_mode_check;
alter table public.quotes add constraint quotes_mode_check check (mode in (
  'Air Freight (AIR)',
  'Air Freight (Consol)',
  'Courier Express (CX)',
  'Sea Freight (FCL)',
  'Sea Freight (LCL)',
  'Road Freight (RDX)'
));

alter table public.jobs drop constraint if exists jobs_mode_check;
alter table public.jobs add constraint jobs_mode_check check (mode in (
  'Air Freight (AIR)',
  'Air Freight (Consol)',
  'Courier Express (CX)',
  'Sea Freight (FCL)',
  'Sea Freight (LCL)',
  'Road Freight (RDX)'
));

create or replace function public.web_form_quote_mode(p_val text)
returns text language sql immutable as $$
  select case
    when p_val ilike '%fcl%'                            then 'Sea Freight (FCL)'
    when p_val ilike '%lcl%'                            then 'Sea Freight (LCL)'
    when p_val ilike '%courier%' or p_val ilike '%(cx)%' then 'Courier Express (CX)'
    when p_val ilike '%road%'                           then 'Road Freight (RDX)'
    when p_val ilike '%consol%' and p_val ilike '%air%' then 'Air Freight (Consol)'
    when p_val ilike '%air%'                            then 'Air Freight (AIR)'
    else null
  end;
$$;

-- portal_request_quote as in 0149, plus 'Air Freight (Consol)' in the modes.
create or replace function public.portal_request_quote(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  qid uuid;
  ref text;
  prefix text;
  m text := coalesce(nullif(p ->> 'mode', ''), 'Air Freight (AIR)');
  item jsonb;
  pos int := 0;
  sp uuid;
  rids uuid[];
begin
  if cid is null then
    raise exception 'Only a customer portal login can request a quote';
  end if;
  if m not in ('Air Freight (AIR)', 'Air Freight (Consol)', 'Courier Express (CX)', 'Sea Freight (FCL)', 'Sea Freight (LCL)', 'Road Freight (RDX)') then
    raise exception 'Unknown mode %', m;
  end if;
  prefix := case
    when m ilike 'sea%' then 'SEA'
    when m ilike 'road%' then 'RDX'
    when m ilike 'courier%' then 'CX'
    else 'AIR'
  end;
  loop
    ref := prefix || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.quotes where reference = ref)
          and not exists (select 1 from public.jobs where reference = ref);
  end loop;
  select sales_person_id into sp from public.clients where id = cid;
  select coalesce(array_agg(r.id), '{}') into rids
  from public.wms_receipts r
  where r.client_id = cid
    and r.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'receipt_ids', '[]'::jsonb)) x);

  insert into public.quotes (
    reference, client_id, mode, commodity, origin, destination, incoterms,
    customer_reference, commercial_value, value_currency, status, sales_person_id,
    portal_requested_at, portal_requested_by, request_ready_date, request_pickup,
    request_delivery, request_notes, wms_receipt_ids
  ) values (
    ref, cid, m,
    nullif(p ->> 'commodity', ''), nullif(p ->> 'origin', ''), nullif(p ->> 'destination', ''),
    nullif(p ->> 'incoterms', ''), nullif(p ->> 'customer_reference', ''),
    nullif(p ->> 'commercial_value', '')::numeric,
    coalesce(nullif(p ->> 'value_currency', ''), 'ZAR'),
    'open', sp,
    now(), auth.uid(), nullif(p ->> 'ready_date', '')::date,
    nullif(p ->> 'pickup', ''), nullif(p ->> 'delivery', ''), nullif(p ->> 'notes', ''),
    rids
  ) returning id into qid;

  for item in select * from jsonb_array_elements(coalesce(p -> 'packing', '[]'::jsonb)) loop
    insert into public.packing_list_items (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
    values (
      qid, pos,
      coalesce(nullif(item ->> 'length_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'width_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'height_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'actual_kg', '')::numeric, 0),
      coalesce(nullif(item ->> 'qty_ctns', '')::numeric, 0)
    );
    pos := pos + 1;
  end loop;
  return qid;
end;
$$;
grant execute on function public.portal_request_quote(jsonb) to authenticated;
