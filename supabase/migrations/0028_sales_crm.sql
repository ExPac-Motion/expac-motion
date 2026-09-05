-- ============================================================
-- 0028  Sales CRM: Lead -> Customer lifecycle
-- ============================================================
-- Phase 1 of the Sales CRM brief: sub-nav structure, Lead/Customer
-- lifecycle, CSV import support, and a manageable Lead Statuses list.
--
-- A Lead is promoted to a real Customer (a clients row) the first time
-- EITHER of these happens:
--   1. A quote tied to the lead (quotes.lead_id) gets accepted — reuses
--      the existing accept_quote() RPC, extended below, not a new trigger.
--   2. Someone sets the lead's status to one flagged
--      lead_statuses.promotes_to_customer (seeded on "Active Customer").
-- Both paths call the same promote_lead_to_customer() function, so
-- whichever happens first wins and the lead's own row is never deleted or
-- duplicated — it just gains promoted_client_id/promoted_at, and any
-- quote already tied to it gets repointed at the new client.
--
-- Run in the Supabase SQL editor after 0027. Self-contained & idempotent.

create table if not exists public.lead_statuses (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique,
  promotes_to_customer boolean not null default false,
  sort_order           int not null default 0,
  created_at           timestamptz not null default now()
);

insert into public.lead_statuses (name, promotes_to_customer, sort_order) values
  ('Hot Lead', false, 1),
  ('Active Customer', true, 2),
  ('Bad Fit', false, 3)
on conflict (name) do nothing;

alter table public.lead_statuses enable row level security;
drop policy if exists "team full access" on public.lead_statuses;
create policy "team full access" on public.lead_statuses
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.leads (
  id                 uuid primary key default gen_random_uuid(),
  company            text not null,
  contact            text,
  email              text,
  phone              text,
  source             text,
  notes              text,
  lead_status_id     uuid references public.lead_statuses (id) on delete set null,
  sales_person_id    uuid references public.profiles (id) on delete set null,
  promoted_client_id uuid references public.clients (id) on delete set null,
  promoted_at        timestamptz,
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists leads_status_idx on public.leads (lead_status_id);
create index if not exists leads_sales_person_idx on public.leads (sales_person_id);

alter table public.leads enable row level security;
drop policy if exists "team full access" on public.leads;
create policy "team full access" on public.leads
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A quote can be raised for a lead before they're a real customer.
alter table public.quotes add column if not exists lead_id uuid references public.leads (id) on delete set null;

create or replace function public.promote_lead_to_customer(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_client_id uuid;
  lead public.leads%rowtype;
begin
  select * into lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  if lead.promoted_client_id is not null then
    return lead.promoted_client_id;
  end if;

  insert into public.clients (company, contact, email, phone)
  values (lead.company, lead.contact, lead.email, lead.phone)
  returning id into v_client_id;

  update public.leads
     set promoted_client_id = v_client_id, promoted_at = now(), updated_at = now()
   where id = p_lead_id;

  update public.quotes
     set client_id = v_client_id
   where lead_id = p_lead_id and client_id is null;

  return v_client_id;
end;
$$;

create or replace function public.on_lead_status_change()
returns trigger language plpgsql security invoker as $$
declare
  should_promote boolean;
begin
  if new.lead_status_id is distinct from old.lead_status_id and new.lead_status_id is not null then
    select promotes_to_customer into should_promote
      from public.lead_statuses where id = new.lead_status_id;
    if should_promote and new.promoted_client_id is null then
      perform public.promote_lead_to_customer(new.id);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists on_lead_status_change on public.leads;
create trigger on_lead_status_change
  after update on public.leads
  for each row execute function public.on_lead_status_change();

-- accept_quote(): promote the lead first (if any) so the new job/tasks
-- land against a real client_id, same as a quote that was never a lead.
create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id    uuid;
  v_client_id uuid;
  q           public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  v_client_id := q.client_id;
  if v_client_id is null and q.lead_id is not null then
    v_client_id := public.promote_lead_to_customer(q.lead_id);
  end if;

  update public.quotes
     set status = 'accepted', client_id = v_client_id, updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, client_id, origin, destination, mode, milestone)
    values
      (q.id, q.reference, v_client_id, q.origin, q.destination, q.mode, 'Booked')
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');

    insert into public.ops_tasks (kind, title, status, priority, job_id, quote_id, client_id)
    values
      ('task', 'Request commercial invoice', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Book carrier', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Send booking confirmation to customer', 'open', 'normal', v_job_id, q.id, v_client_id);
  end if;

  return v_job_id;
end;
$$;

-- save_quote(): accept an optional p_lead_id so a quote can be raised
-- against a not-yet-promoted lead (client_id stays null until acceptance,
-- or until the lead is promoted some other way first).
create or replace function public.save_quote(
  p_id                uuid,
  p_reference         text,
  p_client_id         uuid,
  p_supplier_id       uuid,
  p_agent_id          uuid,
  p_transporter_id    uuid,
  p_clearing_agent_id uuid,
  p_mode              text,
  p_commodity         text,
  p_origin            text,
  p_destination       text,
  p_delivery_terms    text,
  p_valid_until       date,
  p_status            text,
  p_commercial_value  numeric,
  p_insurance_amount  numeric,
  p_incoterms         text,
  p_vessel_name       text,
  p_mbl_no            text,
  p_hbl_no            text,
  p_container_no      text,
  p_etd               date,
  p_eta               date,
  p_mawb_no           text,
  p_hawb_no           text,
  p_flight_no         text,
  p_flight_date       date,
  p_carrier_name      text,
  p_fx_usd_zar        numeric,
  p_fx_cny_zar        numeric,
  p_lines             jsonb,
  p_packing           jsonb,
  p_lead_id           uuid default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.quotes
      (reference, client_id, supplier_id, agent_id, transporter_id,
       clearing_agent_id, mode, commodity, origin, destination, delivery_terms,
       valid_until, status, commercial_value, insurance_amount, incoterms,
       vessel_name, mbl_no, hbl_no, container_no, etd, eta, mawb_no, hawb_no,
       flight_no, flight_date, carrier_name, fx_usd_zar, fx_cny_zar, lead_id)
    values
      (p_reference, p_client_id, p_supplier_id, p_agent_id, p_transporter_id,
       p_clearing_agent_id, p_mode, p_commodity, p_origin, p_destination,
       p_delivery_terms, p_valid_until, p_status, p_commercial_value,
       p_insurance_amount, p_incoterms, p_vessel_name, p_mbl_no, p_hbl_no,
       p_container_no, p_etd, p_eta, p_mawb_no, p_hawb_no, p_flight_no,
       p_flight_date, p_carrier_name,
       coalesce(p_fx_usd_zar, 0), coalesce(p_fx_cny_zar, 0), p_lead_id)
    returning id into v_id;
  else
    update public.quotes set
      reference         = p_reference,
      client_id         = p_client_id,
      supplier_id       = p_supplier_id,
      agent_id          = p_agent_id,
      transporter_id    = p_transporter_id,
      clearing_agent_id = p_clearing_agent_id,
      mode              = p_mode,
      commodity         = p_commodity,
      origin            = p_origin,
      destination       = p_destination,
      delivery_terms    = p_delivery_terms,
      valid_until       = p_valid_until,
      status            = p_status,
      commercial_value  = p_commercial_value,
      insurance_amount  = p_insurance_amount,
      incoterms         = p_incoterms,
      vessel_name       = p_vessel_name,
      mbl_no            = p_mbl_no,
      hbl_no            = p_hbl_no,
      container_no      = p_container_no,
      etd               = p_etd,
      eta               = p_eta,
      mawb_no           = p_mawb_no,
      hawb_no           = p_hawb_no,
      flight_no         = p_flight_no,
      flight_date       = p_flight_date,
      carrier_name      = p_carrier_name,
      fx_usd_zar        = coalesce(p_fx_usd_zar, 0),
      fx_cny_zar        = coalesce(p_fx_cny_zar, 0),
      lead_id           = p_lead_id,
      updated_at        = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Quote % not found', p_id;
    end if;
  end if;

  delete from public.quote_lines where quote_id = v_id;

  insert into public.quote_lines
    (quote_id, position, category, code, description, cur, unit, qty, buy, margin, vat_pct, sell)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(nullif(line ->> 'category', ''), 'International Freight Charges'),
    coalesce(line ->> 'code', ''),
    coalesce(line ->> 'description', ''),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce(line ->> 'unit', ''),
    coalesce((line ->> 'qty')::numeric, 0),
    coalesce((line ->> 'buy')::numeric, 0),
    coalesce((line ->> 'margin')::numeric, 0),
    coalesce((line ->> 'vat_pct')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  delete from public.packing_list_items where quote_id = v_id;

  insert into public.packing_list_items
    (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
  select
    v_id,
    coalesce((pk ->> 'position')::int, (ord - 1)::int),
    coalesce((pk ->> 'length_cm')::numeric, 0),
    coalesce((pk ->> 'width_cm')::numeric, 0),
    coalesce((pk ->> 'height_cm')::numeric, 0),
    coalesce((pk ->> 'actual_kg')::numeric, 0),
    coalesce((pk ->> 'qty_ctns')::numeric, 0)
  from jsonb_array_elements(coalesce(p_packing, '[]'::jsonb)) with ordinality as t(pk, ord);

  return v_id;
end;
$$;
