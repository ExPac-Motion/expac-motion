-- 0142: Customer record (tabs: General, Contacts, Other Details, Bank Detail,
-- Documents, Permits / Certificates, Products & SKUs, Consignees & Shippers,
-- Associated Leads, Margins & Charges) + shippers belong to a customer.
--
-- Shippers move out of the Suppliers (now "Vendors") menu: every shipper is
-- the customer's own (suppliers.client_id). A shipper used by several
-- customers is copied to each of them and that customer's quotes, shipments
-- and warehouse receipts are re-pointed to its copy. The portal's Customer
-- Party lists the customer's own shippers.

-- ---------- 1. General / Other details / Bank / Margins fields ----------
alter table public.clients
  add column if not exists client_code text,
  add column if not exists fax text,
  add column if not exists customer_segment text,
  add column if not exists network_group text,
  add column if not exists is_also_agent boolean not null default false,
  add column if not exists linked_agent_id uuid references public.agents (id) on delete set null,
  add column if not exists customer_support_id uuid references public.profiles (id) on delete set null,
  add column if not exists quote_note text,
  add column if not exists bill_to_name text,
  add column if not exists parent_client_id uuid references public.clients (id) on delete set null,
  -- primary contact
  add column if not exists contact_salutation text,
  add column if not exists contact_first_name text,
  add column if not exists contact_last_name text,
  add column if not exists contact_role text,
  add column if not exists contact_mobile text,
  add column if not exists mailing_list boolean not null default true,
  add column if not exists additional_emails text,
  -- other details
  add column if not exists registration_no text,
  add column if not exists industry text,
  add column if not exists physical_address text,
  add column if not exists postal_address text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists payment_terms text,
  add column if not exists credit_limit numeric(14, 2),
  add column if not exists billing_currency text,
  -- bank detail
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists bank_branch_code text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_no text,
  add column if not exists bank_account_type text,
  add column if not exists bank_swift text,
  -- margins & charges
  add column if not exists margin_override_pct numeric(6, 2),
  add column if not exists charges_note text;
create unique index if not exists clients_client_code_uk on public.clients (lower(client_code)) where client_code is not null and client_code <> '';

alter table public.client_contacts
  add column if not exists salutation text,
  add column if not exists mobile text;

-- ---------- 2. Shippers belong to a customer ----------
alter table public.suppliers
  add column if not exists client_id uuid references public.clients (id) on delete set null;
create index if not exists suppliers_client_idx on public.suppliers (client_id);

-- A customer's own "also a shipper" mirror row (0072) is that customer's.
update public.suppliers set client_id = source_client_id
where client_id is null and source_client_id is not null;

do $
declare
  s record;
  c uuid;
  first_client uuid;
  copy_id uuid;
begin
  for s in select * from public.suppliers where client_id is null loop
    first_client := null;
    for c in
      select distinct x.client_id from (
        select client_id from public.jobs where supplier_id = s.id
        union select client_id from public.quotes where supplier_id = s.id
        union select client_id from public.wms_receipts where supplier_id = s.id
      ) x
      where x.client_id is not null
      order by 1
    loop
      if first_client is null then
        first_client := c;
        update public.suppliers set client_id = c where id = s.id;
      else
        -- A copy for every further customer; mirror links (0072) stay on the original.
        insert into public.suppliers (company, contact, email, phone, vat_no, import_code, address, client_id)
        values (s.company, s.contact, s.email, s.phone, s.vat_no, s.import_code, s.address, c)
        returning id into copy_id;
        update public.jobs set supplier_id = copy_id where supplier_id = s.id and client_id = c;
        update public.quotes set supplier_id = copy_id where supplier_id = s.id and client_id = c;
        update public.wms_receipts set supplier_id = copy_id where supplier_id = s.id and client_id = c;
      end if;
    end loop;
  end loop;
end $$;

-- Portal › Customer Party: the customer's own shippers (+ any used on its shipments).
create or replace view public.client_suppliers
with (security_barrier = true) as
select distinct s.id, s.company, s.contact, s.email, s.phone
from public.suppliers s
where s.client_id = public.my_client_id()
   or exists (select 1 from public.jobs j where j.supplier_id = s.id and j.client_id = public.my_client_id());
grant select on public.client_suppliers to authenticated;

-- ---------- 3. Consignees (the customer's delivery address book) ----------
create table if not exists public.client_consignees (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  company text not null default '',
  contact text,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists client_consignees_client_idx on public.client_consignees (client_id);
alter table public.client_consignees enable row level security;
drop policy if exists "team full access" on public.client_consignees;
create policy "team full access" on public.client_consignees for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- 4. Customer documents, permits & certificates ----------
create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null default 'document' check (kind in ('document', 'permit')),
  name text not null,
  doc_type text,
  number text,
  issued_on date,
  expires_on date,
  notes text,
  storage_path text,
  size_bytes bigint,
  visible_to_client boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists client_files_client_idx on public.client_files (client_id);
alter table public.client_files enable row level security;
drop policy if exists "team full access" on public.client_files;
create policy "team full access" on public.client_files for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Deleting needs the delete permission, like every other record (0132).
do $$
declare
  t text;
begin
  foreach t in array array['client_consignees', 'client_files'] loop
    execute format('drop policy if exists "delete needs permission" on public.%I', t);
    execute format(
      'create policy "delete needs permission" on public.%I as restrictive
         for delete to authenticated
         using (public.has_perm(''delete'') or not public.is_staff())', t);
  end loop;
end $$;

-- ---------- 5. Customer portal login made by an admin (/api/customer-login) ----------
create or replace function public.admin_link_client_login(p_user uuid, p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
begin
  select * into me from public.profiles where id = p_user;
  if not found then
    raise exception 'No profile for that login';
  end if;
  if me.role in ('admin', 'user', 'partner') then
    raise exception 'That email already belongs to an ExPac staff or partner login';
  end if;
  if me.client_id is not null and me.client_id <> p_client then
    raise exception 'That email is already linked to another customer';
  end if;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set role = 'client', client_id = p_client, portal_status = 'approved'
   where id = p_user;
  perform set_config('expac.trusted_profile_update', 'off', true);
end;
$$;
revoke execute on function public.admin_link_client_login(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_link_client_login(uuid, uuid) to service_role;
