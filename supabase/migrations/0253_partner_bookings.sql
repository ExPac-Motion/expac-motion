-- =====================================================================
-- 0253 Partner Portal: partners send ExPac their own shipments
-- =====================================================================
-- An overseas agent (or any partner) hands ExPac one of their own
-- shipments to handle, usually at destination. The PARTNER is ExPac's
-- customer and is billed; the SA importer is the consignee.
--
--   partner_client_links        partner <-> its customer record (clients);
--                               created on the first booking, named after
--                               the partner
--   quotes.from_partner_kind/id the partner who requested the quotation
--   quotes.partner_services     services asked for (clearance, delivery...)
--
--   partner_request_booking(p)          new quotation request (lands in
--                                       Quotations as a New Lead + a sales task)
--   partner_bookings()                  the partner's requests, status, shipment
--   partner_booking_lines(quote)        the quotation lines once sent (the same
--                                       fields a customer portal login sees)
--   partner_booking_decision(q, ok, why) accept / decline ExPac's quotation
--                                       (accept = won: the shipment is created)
--
-- Run in the Supabase SQL editor after 0252. Self-contained & idempotent.
-- =====================================================================

create table if not exists public.partner_client_links (
  partner_kind  text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id    uuid not null,
  client_id     uuid not null references public.clients (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (partner_kind, partner_id)
);
alter table public.partner_client_links enable row level security;
drop policy if exists "team full access" on public.partner_client_links;
create policy "team full access" on public.partner_client_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.quotes add column if not exists from_partner_kind text;
alter table public.quotes add column if not exists from_partner_id uuid;
alter table public.quotes add column if not exists partner_services text[];
create index if not exists quotes_from_partner_idx on public.quotes (from_partner_kind, from_partner_id) where from_partner_id is not null;

-- The signed-in partner's customer record, created on first use.
create or replace function public.partner_client_id()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  cid uuid;
  r record;
begin
  if p is null then
    raise exception 'Only a partner portal login can do this';
  end if;
  select l.client_id into cid from public.partner_client_links l where l.partner_kind = k and l.partner_id = p;
  if cid is not null then
    return cid;
  end if;
  if k = 'agent' then
    select company, contact, email, phone, address into r from public.agents where id = p;
  elsif k = 'transporter' then
    select company, contact, email, phone, address into r from public.transporters where id = p;
  elsif k = 'clearing_agent' then
    select company, contact, email, phone, address into r from public.clearing_agents where id = p;
  else
    select company, contact, email, phone, address into r from public.destination_agents where id = p;
  end if;
  insert into public.clients (company, contact, email, phone, address, created_by)
  values (coalesce(r.company, 'Partner'), r.contact, r.email, r.phone, r.address, null)
  returning id into cid;
  insert into public.partner_client_links (partner_kind, partner_id, client_id) values (k, p, cid);
  return cid;
end;
$$;
revoke execute on function public.partner_client_id() from public, anon, authenticated;

-- ---------- New booking request ----------
-- p (jsonb): mode, origin, destination, commodity, incoterms, customer_reference,
--   ready_date, etd, eta, master_bill, house_bill, consignee (text: company,
--   address, contact), delivery (address), notes, services (text[]), packing[]
create or replace function public.partner_request_booking(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  pid uuid := public.my_partner_id();
  who text := coalesce(public.partner_company_name(), 'Partner');
  cid uuid;
  qid uuid;
  ref text;
  prefix text;
  m text := coalesce(nullif(p ->> 'mode', ''), 'Air Freight (AIR)');
  item jsonb;
  pos int := 0;
  svc text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), '{}');
  extra text;
begin
  if pid is null then
    raise exception 'Only a partner portal login can send ExPac a shipment';
  end if;
  if m not in ('Air Freight (AIR)', 'Air Freight (Consol)', 'Courier Express (CX)', 'Sea Freight (FCL)', 'Sea Freight (LCL)', 'Road Freight (RDX)') then
    raise exception 'Unknown mode %', m;
  end if;
  if coalesce(p ->> 'origin', '') = '' or coalesce(p ->> 'destination', '') = '' then
    raise exception 'Enter the origin and destination';
  end if;
  cid := public.partner_client_id();
  prefix := case when m ilike 'sea%' then 'SEA' when m ilike 'road%' then 'RDX' when m ilike 'courier%' then 'CX' else 'AIR' end;
  loop
    ref := prefix || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.quotes where reference = ref)
          and not exists (select 1 from public.jobs where reference = ref);
  end loop;

  extra := concat_ws(E'\n',
    'Booked by partner: ' || who,
    case when cardinality(svc) > 0 then 'Services: ' || array_to_string(svc, ', ') end,
    'Consignee: ' || nullif(p ->> 'consignee', ''),
    'Master bill: ' || nullif(p ->> 'master_bill', ''),
    'House bill: ' || nullif(p ->> 'house_bill', ''),
    'ETD: ' || nullif(p ->> 'etd', ''),
    'ETA: ' || nullif(p ->> 'eta', ''),
    nullif(p ->> 'notes', ''));

  insert into public.quotes (
    reference, client_id, mode, commodity, origin, destination, incoterms,
    customer_reference, status, portal_requested_at, portal_requested_by,
    request_ready_date, request_pickup, request_delivery, request_notes,
    from_partner_kind, from_partner_id, partner_services
  ) values (
    ref, cid, m,
    nullif(p ->> 'commodity', ''), nullif(p ->> 'origin', ''), nullif(p ->> 'destination', ''),
    nullif(p ->> 'incoterms', ''), nullif(p ->> 'customer_reference', ''),
    'open', now(), auth.uid(),
    nullif(p ->> 'ready_date', '')::date, nullif(p ->> 'pickup', ''),
    coalesce(nullif(p ->> 'delivery', ''), nullif(p ->> 'consignee', '')), extra,
    k, pid, svc
  ) returning id into qid;

  for item in select * from jsonb_array_elements(coalesce(p -> 'packing', '[]'::jsonb)) loop
    insert into public.packing_list_items (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns, qty_pcs)
    values (
      qid, pos,
      coalesce(nullif(item ->> 'length_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'width_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'height_cm', '')::numeric, 0),
      coalesce(nullif(item ->> 'actual_kg', '')::numeric, 0),
      coalesce(nullif(item ->> 'qty_ctns', '')::numeric, 0),
      coalesce(nullif(item ->> 'qty_pcs', '')::numeric, 0));
    pos := pos + 1;
  end loop;

  insert into public.ops_tasks (kind, title, body, status, priority, quote_id, client_id, created_by,
                                agent_id, transporter_id, clearing_agent_id)
  values ('task', 'Partner booking: quote ' || ref || ' for ' || who,
          m || ', ' || coalesce(p ->> 'origin', '') || ' to ' || coalesce(p ->> 'destination', '')
            || E'.\nThe partner is the customer (billed). Price it and send the quotation from Quotations.',
          'open', 'high', qid, cid, auth.uid(),
          case when k = 'agent' then pid end, case when k = 'transporter' then pid end,
          case when k = 'clearing_agent' then pid end);
  return qid;
end;
$$;
revoke execute on function public.partner_request_booking(jsonb) from public, anon;
grant execute on function public.partner_request_booking(jsonb) to authenticated;

-- ---------- The partner's bookings ----------
create or replace function public.partner_bookings()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'reference', q.reference, 'mode', q.mode, 'origin', q.origin, 'destination', q.destination,
           'commodity', q.commodity, 'incoterms', q.incoterms, 'customer_reference', q.customer_reference,
           'status', q.status, 'valid_until', q.valid_until, 'sell_currency', q.sell_currency,
           'portal_decision', q.portal_decision, 'portal_decline_reason', q.portal_decline_reason,
           'services', q.partner_services, 'created_at', q.created_at,
           'job', (select jsonb_build_object('id', j.id, 'reference', j.reference, 'shipment_status', j.shipment_status,
                                             'etd', j.etd, 'eta', j.eta)
                     from public.jobs j where j.quote_id = q.id order by j.created_at desc limit 1))
         order by q.created_at desc), '[]'::jsonb)
    from public.quotes q
   where q.from_partner_kind = public.my_partner_kind() and q.from_partner_id = public.my_partner_id();
$$;
revoke execute on function public.partner_bookings() from public, anon;
grant execute on function public.partner_bookings() to authenticated;

-- Quotation lines once ExPac has sent it (client-visible fields only).
create or replace function public.partner_booking_lines(p_quote uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'quote_id', l.quote_id, 'position', l.position, 'category', l.category, 'code', l.code,
           'description', l.description, 'unit', l.unit, 'qty', l.qty, 'cur', l.cur, 'vat_pct', l.vat_pct, 'sell', l.sell)
         order by l.position), '[]'::jsonb)
    from public.quote_lines l join public.quotes q on q.id = l.quote_id
   where l.quote_id = p_quote
     and q.from_partner_kind = public.my_partner_kind() and q.from_partner_id = public.my_partner_id()
     and q.status <> 'open';
$$;
revoke execute on function public.partner_booking_lines(uuid) from public, anon;
grant execute on function public.partner_booking_lines(uuid) to authenticated;

-- Accept / decline ExPac's quotation (same rules as portal_quote_decision).
create or replace function public.partner_booking_decision(p_quote uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote;
  if not found or q.from_partner_id is distinct from public.my_partner_id()
     or q.from_partner_kind is distinct from public.my_partner_kind() then
    raise exception 'Quotation not found';
  end if;
  if not (q.status = 'sent' or (p_accept and q.status = 'lost')) then
    raise exception 'This quotation can''t be % now', case when p_accept then 'accepted' else 'declined' end;
  end if;
  if q.valid_until is not null and q.valid_until < current_date and p_accept then
    raise exception 'This quotation expired on %, ask ExPac for a revision', to_char(q.valid_until, 'DD/MM/YYYY');
  end if;
  update public.quotes set
    portal_decision = case when p_accept then 'accepted' else 'declined' end,
    portal_decided_at = now(),
    portal_decline_reason = case when p_accept then null else nullif(btrim(coalesce(p_reason, '')), '') end,
    -- Accepted = won: the trg_quote_won trigger creates the shipment.
    status = case when p_accept then 'accepted' else 'lost' end
  where id = p_quote;
end;
$$;
revoke execute on function public.partner_booking_decision(uuid, boolean, text) from public, anon;
grant execute on function public.partner_booking_decision(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
