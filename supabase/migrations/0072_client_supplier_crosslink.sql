-- ============================================================
-- 0072  Customer <-> Shipper cross-listing
-- ============================================================
-- Same pattern as the Agent <-> Clearing Agent cross-link (0014): a company
-- can serve both roles -- sometimes the shipper/exporter is also the
-- customer, and the customer/importer is also the consignee. Ticking the
-- box on one side keeps a mirror row in the other table (kept in sync by
-- trigger), so it shows in that contact book and in the matching dropdown
-- with a valid id. The mirror row is read-only in the UI; editing happens
-- on the master record.
--
-- Only the shared fields (company/contact/email/phone/vat_no/import_code/
-- address) are mirrored -- client-only CRM fields (website, source,
-- sales_person_id, etc.) stay on the master record, same scope as 0014.
--
-- Run in the Supabase SQL editor after 0071. Self-contained & idempotent.

alter table public.clients
  add column if not exists also_shipper       boolean not null default false,
  add column if not exists source_supplier_id uuid
    references public.suppliers (id) on delete cascade;

alter table public.suppliers
  add column if not exists also_customer     boolean not null default false,
  add column if not exists source_client_id  uuid
    references public.clients (id) on delete cascade;

create unique index if not exists suppliers_source_client_uk
  on public.suppliers (source_client_id);
create unique index if not exists clients_source_supplier_uk
  on public.clients (source_supplier_id);

-- clients -> suppliers
create or replace function public.sync_client_to_supplier()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- a mirror row never propagates further
  if NEW.source_supplier_id is not null then
    return NEW;
  end if;

  if NEW.also_shipper then
    insert into public.suppliers
      (company, contact, email, phone, vat_no, import_code, address, source_client_id)
    values
      (NEW.company, NEW.contact, NEW.email, NEW.phone, NEW.vat_no,
       NEW.import_code, NEW.address, NEW.id)
    on conflict (source_client_id) do update set
      company     = excluded.company,
      contact     = excluded.contact,
      email       = excluded.email,
      phone       = excluded.phone,
      vat_no      = excluded.vat_no,
      import_code = excluded.import_code,
      address     = excluded.address;
  else
    delete from public.suppliers where source_client_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_client_to_supplier on public.clients;
create trigger sync_client_to_supplier
  after insert or update on public.clients
  for each row execute function public.sync_client_to_supplier();

-- suppliers -> clients
create or replace function public.sync_supplier_to_client()
returns trigger
language plpgsql
security invoker
as $$
begin
  if NEW.source_client_id is not null then
    return NEW;
  end if;

  if NEW.also_customer then
    insert into public.clients
      (company, contact, email, phone, vat_no, import_code, address, source_supplier_id)
    values
      (NEW.company, NEW.contact, NEW.email, NEW.phone, NEW.vat_no,
       NEW.import_code, NEW.address, NEW.id)
    on conflict (source_supplier_id) do update set
      company     = excluded.company,
      contact     = excluded.contact,
      email       = excluded.email,
      phone       = excluded.phone,
      vat_no      = excluded.vat_no,
      import_code = excluded.import_code,
      address     = excluded.address;
  else
    delete from public.clients where source_supplier_id = NEW.id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_supplier_to_client on public.suppliers;
create trigger sync_supplier_to_client
  after insert or update on public.suppliers
  for each row execute function public.sync_supplier_to_client();

-- Backfill mirrors for any rows already flagged.
update public.clients   set also_shipper  = also_shipper
  where also_shipper and source_supplier_id is null;
update public.suppliers set also_customer = also_customer
  where also_customer and source_client_id is null;
