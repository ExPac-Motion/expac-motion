-- ============================================================
-- 0241  Agent Req for Quote (RFQ): requests, agent replies, rates
-- ============================================================
-- Staff send a quotation's shipment details (no customer / consignee) to one
-- or more agents for case-by-case rates. Each agent gets their own email and
-- a no-login reply link (token). Rates come back through that link or are
-- keyed in by staff; the chosen reply is loaded into the client quote as buy
-- lines in the Quote Builder.
--
--   quote_rfqs            one request: quote, partner type, reply-by, notes,
--                         and a snapshot of the charges asked for.
--   quote_rfq_recipients  one per agent: who, token, status, reply details.
--                         status: awaiting -> received -> used / not_used;
--                         declined (agent can't quote). Overdue is worked
--                         out in the app from reply_by.
--   quote_rfq_rates       the agent's rate per charge code.
--
--   rfq_reply_get(token)      public: the request as the agent sees it.
--   rfq_reply_submit(...)     public: the agent's rates or "can't quote".
--
-- Run in the Supabase SQL editor after 0240. Self-contained & idempotent.

create table if not exists public.quote_rfqs (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes(id) on delete cascade,
  partner_kind text not null default 'agent'
               check (partner_kind in ('agent','destination_agent','transporter','clearing_agent')),
  reply_by     date,
  notes        text,
  charges      jsonb not null default '[]'::jsonb,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists quote_rfqs_quote_idx on public.quote_rfqs (quote_id, created_at);

create table if not exists public.quote_rfq_recipients (
  id             uuid primary key default gen_random_uuid(),
  rfq_id         uuid not null references public.quote_rfqs(id) on delete cascade,
  quote_id       uuid not null references public.quotes(id) on delete cascade,
  partner_id     uuid,
  email          text not null,
  company        text,
  contact        text,
  token          uuid not null default gen_random_uuid() unique,
  status         text not null default 'awaiting'
                 check (status in ('awaiting','received','used','not_used','declined')),
  sent_at        timestamptz not null default now(),
  responded_at   timestamptz,
  responded_via  text check (responded_via in ('link','staff')),
  validity       text,
  transit_time   text,
  remarks        text,
  created_at     timestamptz not null default now()
);
create index if not exists quote_rfq_recipients_quote_idx on public.quote_rfq_recipients (quote_id);
create index if not exists quote_rfq_recipients_rfq_idx on public.quote_rfq_recipients (rfq_id);

create table if not exists public.quote_rfq_rates (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.quote_rfq_recipients(id) on delete cascade,
  position     int not null default 0,
  category     text not null,
  code         text not null default '',
  description  text not null default '',
  unit         text not null default '',
  cur          text not null default 'USD',
  rate         numeric,
  min_charge   numeric,
  remarks      text
);
create index if not exists quote_rfq_rates_recipient_idx on public.quote_rfq_rates (recipient_id, position);

alter table public.quote_rfqs enable row level security;
alter table public.quote_rfq_recipients enable row level security;
alter table public.quote_rfq_rates enable row level security;

drop policy if exists "team full access" on public.quote_rfqs;
create policy "team full access" on public.quote_rfqs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "team full access" on public.quote_rfq_recipients;
create policy "team full access" on public.quote_rfq_recipients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "team full access" on public.quote_rfq_rates;
create policy "team full access" on public.quote_rfq_rates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- public: what the agent sees (no customer, consignee, shipper) ----------
create or replace function public.rfq_reply_get(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'rfq_number', 'RFQ-' || q.reference,
    'mode', q.mode,
    'origin', q.origin,
    'destination', q.destination,
    'incoterms', q.incoterms,
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

-- ---------- public: the agent's reply ----------
-- p_rates: [{category, code, description, unit, cur, rate, min_charge, remarks}]
-- Allowed while the reply hasn't been used (an agent can correct a reply).
create or replace function public.rfq_reply_submit(
  p_token uuid,
  p_rates jsonb,
  p_validity text default null,
  p_transit text default null,
  p_remarks text default null,
  p_decline boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.quote_rfq_recipients;
  ref text;
  n int := 0;
begin
  select * into r from public.quote_rfq_recipients where token = p_token;
  if not found then
    raise exception 'This request link is not valid';
  end if;
  if r.status in ('used','not_used') then
    raise exception 'This request has been closed, please contact ExPac';
  end if;
  if p_rates is not null and jsonb_typeof(p_rates) <> 'array' then
    raise exception 'Rates must be a list';
  end if;
  if jsonb_array_length(coalesce(p_rates, '[]'::jsonb)) > 150 then
    raise exception 'Too many rate lines';
  end if;

  delete from public.quote_rfq_rates where recipient_id = r.id;

  if not p_decline then
    insert into public.quote_rfq_rates
      (recipient_id, position, category, code, description, unit, cur, rate, min_charge, remarks)
    select r.id,
           (e.ord - 1)::int,
           left(coalesce(e.v->>'category', ''), 120),
           left(coalesce(e.v->>'code', ''), 20),
           left(coalesce(e.v->>'description', ''), 200),
           left(coalesce(e.v->>'unit', ''), 20),
           case when upper(coalesce(e.v->>'cur', '')) in ('USD','CNY','ZAR','EUR','GBP')
                then upper(e.v->>'cur') else 'USD' end,
           case when (e.v->>'rate') ~ '^\s*\d+(\.\d+)?\s*$' then (e.v->>'rate')::numeric end,
           case when (e.v->>'min_charge') ~ '^\s*\d+(\.\d+)?\s*$' then (e.v->>'min_charge')::numeric end,
           nullif(left(coalesce(e.v->>'remarks', ''), 300), '')
    from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) with ordinality as e(v, ord)
    where (e.v->>'rate') ~ '^\s*\d+(\.\d+)?\s*$'
       or (e.v->>'min_charge') ~ '^\s*\d+(\.\d+)?\s*$'
       or nullif(trim(coalesce(e.v->>'remarks', '')), '') is not null;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'Please enter at least one rate, or choose "We can''t quote"';
    end if;
  end if;

  update public.quote_rfq_recipients
     set status = case when p_decline then 'declined' else 'received' end,
         responded_at = now(),
         responded_via = 'link',
         validity = nullif(left(coalesce(p_validity, ''), 120), ''),
         transit_time = nullif(left(coalesce(p_transit, ''), 120), ''),
         remarks = nullif(left(coalesce(p_remarks, ''), 2000), '')
   where id = r.id;

  -- A line on the quote's Messages thread so staff see the reply arrive.
  select reference into ref from public.quotes where id = r.quote_id;
  insert into public.quote_messages (quote_id, kind, direction, body, status, from_email, created_by)
  values (
    r.quote_id, 'note', 'in',
    case when p_decline
      then 'RFQ-' || ref || ': ' || coalesce(r.company, r.email) || ' can''t quote.'
      else 'RFQ-' || ref || ': rates received from ' || coalesce(r.company, r.email) || ' (' || n || ' charges).'
    end,
    'sent', r.email, null
  );
  return case when p_decline then 'declined' else 'received' end;
end;
$$;
revoke execute on function public.rfq_reply_submit(uuid, jsonb, text, text, text, boolean) from public;
grant execute on function public.rfq_reply_submit(uuid, jsonb, text, text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
