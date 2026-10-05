-- 0141: Customer Portal v2 (front office). Customers request quotes from the
-- portal (lands as a New Lead quotation for ExPac to complete, price and
-- send), see the sent quotation with its charges, and accept or decline it
-- (accepting wins the quote, which creates the shipment as before). Profiles
-- get a greeting ("Good day, Mr Gilbert").

-- ---------- 1. Quote request fields ----------
alter table public.quotes
  add column if not exists portal_requested_at timestamptz,
  add column if not exists portal_requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists request_ready_date date,
  add column if not exists request_pickup text,
  add column if not exists request_delivery text,
  add column if not exists request_notes text,
  add column if not exists portal_decision text check (portal_decision in ('accepted', 'declined')),
  add column if not exists portal_decided_at timestamptz,
  add column if not exists portal_decline_reason text;

-- ---------- 2. Customer view of quotes: the new fields + customer reference ----------
create or replace view public.client_quotes
with (security_barrier = true) as
select
  q.id, q.reference, q.client_id, q.mode, q.commodity, q.origin, q.destination,
  q.delivery_terms, q.valid_until, q.status, q.commercial_value,
  q.insurance_amount, q.vessel_name, q.mbl_no, q.hbl_no, q.container_no,
  q.etd, q.eta, q.incoterms, q.mawb_no, q.hawb_no, q.flight_no, q.flight_date,
  q.carrier_name, q.created_at,
  s.company as supplier_company,
  q.customer_reference, q.portal_requested_at, q.request_ready_date, q.request_pickup,
  q.request_delivery, q.request_notes, q.portal_decision, q.portal_decided_at,
  q.portal_decline_reason, q.sell_currency, q.accepted_at
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
where q.client_id = public.my_client_id();
grant select on public.client_quotes to authenticated;

-- Packing list of the customer's own quotes (their request's cargo lines).
create or replace view public.client_packing_items
with (security_barrier = true) as
select p.id, p.quote_id, p.position, p.length_cm, p.width_cm, p.height_cm, p.actual_kg, p.qty_ctns, p.cbm
from public.packing_list_items p
join public.quotes q on q.id = p.quote_id
where q.client_id = public.my_client_id();
grant select on public.client_packing_items to authenticated;

-- ---------- 3. Request a quote ----------
-- p: {mode, origin, destination, commodity, incoterms, customer_reference,
--     commercial_value, value_currency, ready_date, pickup, delivery, notes,
--     packing: [{length_cm, width_cm, height_cm, actual_kg, qty_ctns}]}
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
begin
  if cid is null then
    raise exception 'Only a customer portal login can request a quote';
  end if;
  if m not in ('Air Freight (AIR)', 'Courier Express (CX)', 'Sea Freight (FCL)', 'Sea Freight (LCL)', 'Road Freight (RDX)') then
    raise exception 'Unknown mode %', m;
  end if;
  prefix := case
    when m ilike 'sea%' then 'SEA'
    when m ilike 'road%' then 'RDX'
    when m ilike 'courier%' then 'CX'
    else 'AIR'
  end;
  -- Same shape as the Quote Builder's references (prefix + 6 digits), unique.
  loop
    ref := prefix || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.quotes where reference = ref)
          and not exists (select 1 from public.jobs where reference = ref);
  end loop;
  select sales_person_id into sp from public.clients where id = cid;

  insert into public.quotes (
    reference, client_id, mode, commodity, origin, destination, incoterms,
    customer_reference, commercial_value, value_currency, status, sales_person_id,
    portal_requested_at, portal_requested_by, request_ready_date, request_pickup,
    request_delivery, request_notes
  ) values (
    ref, cid, m,
    nullif(p ->> 'commodity', ''), nullif(p ->> 'origin', ''), nullif(p ->> 'destination', ''),
    nullif(p ->> 'incoterms', ''), nullif(p ->> 'customer_reference', ''),
    nullif(p ->> 'commercial_value', '')::numeric,
    coalesce(nullif(p ->> 'value_currency', ''), 'ZAR'),
    'open', sp,
    now(), auth.uid(), nullif(p ->> 'ready_date', '')::date,
    nullif(p ->> 'pickup', ''), nullif(p ->> 'delivery', ''), nullif(p ->> 'notes', '')
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

-- ---------- 4. Accept / decline a sent quotation ----------
create or replace function public.portal_quote_decision(p_quote uuid, p_accept boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote;
  if not found or q.client_id is null or q.client_id is distinct from public.my_client_id() then
    raise exception 'Quotation not found';
  end if;
  if q.status <> 'sent' then
    raise exception 'This quotation can''t be % now', case when p_accept then 'accepted' else 'declined' end;
  end if;
  if q.valid_until is not null and q.valid_until < current_date and p_accept then
    raise exception 'This quotation expired on % — ask ExPac for an updated one', to_char(q.valid_until, 'DD/MM/YYYY');
  end if;
  update public.quotes set
    portal_decision = case when p_accept then 'accepted' else 'declined' end,
    portal_decided_at = now(),
    portal_decline_reason = case when p_accept then null else nullif(p_reason, '') end,
    -- Accepted = won: the trg_quote_won trigger creates the shipment.
    status = case when p_accept then 'accepted' else 'lost' end
  where id = p_quote;
end;
$$;
grant execute on function public.portal_quote_decision(uuid, boolean, text) to authenticated;

-- ---------- 5. Greeting on the portal ----------
alter table public.profiles add column if not exists greeting text;

-- ---------- 6. The customer's own company card (sidebar, dashboard) ----------
create or replace view public.client_me
with (security_barrier = true) as
select c.id, c.company, c.contact, c.email, c.phone, c.address,
       sp.full_name as account_manager
from public.clients c
left join public.profiles sp on sp.id = c.sales_person_id
where c.id = public.my_client_id();
grant select on public.client_me to authenticated;
