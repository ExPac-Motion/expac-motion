-- ============================================================
-- 0054  Sales CRM: Lead / Customer edit-form parity
-- ============================================================
-- A Lead generally becomes a Customer, so the two edit forms should
-- capture the same profile. This adds the lead's company / marketing
-- fields to public.clients, a child table for extra contacts (mirrors
-- public.lead_contacts), and the customs import code to public.leads.
--
-- promote_lead_to_customer() now copies the WHOLE lead profile plus its
-- extra contacts across at promotion time (one-time copy — the two rows
-- are independent afterwards).
--
-- Run in the Supabase SQL editor after 0053. Self-contained & idempotent.

alter table public.clients
  add column if not exists company_phone   text,
  add column if not exists website         text,
  add column if not exists source          text,
  add column if not exists description     text,
  add column if not exists notes           text,
  add column if not exists sales_person_id uuid references public.profiles (id) on delete set null;
create index if not exists clients_sales_person_idx on public.clients (sales_person_id);

alter table public.leads
  add column if not exists import_code text;

-- Extra people at a customer company (clients.contact stays primary) —
-- mirrors public.lead_contacts so a promoted lead carries its list across.
create table if not exists public.client_contacts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  name       text not null default '',
  role       text,
  email      text,
  phone      text,
  created_at timestamptz not null default now()
);
create index if not exists client_contacts_client_idx on public.client_contacts (client_id);

alter table public.client_contacts enable row level security;
drop policy if exists "team full access" on public.client_contacts;
create policy "team full access" on public.client_contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Promotion copies the full lead profile + its extra contacts.
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

  insert into public.clients (
    company, contact, email, phone, company_phone, website, address,
    vat_no, import_code, source, description, notes, sales_person_id
  )
  values (
    lead.company, lead.contact, lead.email, lead.phone, lead.company_phone,
    lead.website, lead.address, lead.vat_no, lead.import_code, lead.source,
    lead.description, lead.notes, lead.sales_person_id
  )
  returning id into v_client_id;

  insert into public.client_contacts (client_id, name, role, email, phone)
  select v_client_id, name, role, email, phone
    from public.lead_contacts
   where lead_id = p_lead_id;

  update public.leads
     set promoted_client_id = v_client_id, promoted_at = now(), updated_at = now()
   where id = p_lead_id;

  update public.quotes
     set client_id = v_client_id
   where lead_id = p_lead_id and client_id is null;

  return v_client_id;
end;
$$;
