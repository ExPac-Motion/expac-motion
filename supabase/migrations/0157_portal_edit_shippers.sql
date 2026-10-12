-- ============================================================
-- 0157  Customer Portal › Customer Party: customers edit their shippers
-- ============================================================
-- A portal login (with the Customer Party permission, portal_permissions
-- "suppliers") can add its own shippers, edit their details (company,
-- contact, email, phone, address, VAT no) and remove one that no quote,
-- shipment or warehouse receipt uses. Only the customer's own shippers
-- (suppliers.client_id, 0142) can be changed; a shipper ExPac put on a
-- shipment that belongs to someone else stays read-only.
-- Motion sees the changes straight away (same suppliers rows).
--
-- Run in the Supabase SQL editor after 0156. Self-contained & idempotent.

create or replace function public.my_party_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p
   where p.id = auth.uid() and p.role = 'client'
     and coalesce(p.portal_permissions ->> 'suppliers', 'true') <> 'false';
$$;
grant execute on function public.my_party_client_id() to authenticated;

-- The view gains address / VAT no and whether the customer may edit it.
create or replace view public.client_suppliers
with (security_barrier = true) as
select distinct s.id, s.company, s.contact, s.email, s.phone,
       s.address, s.vat_no,
       (s.client_id is not null and s.client_id = public.my_client_id()) as editable
from public.suppliers s
where s.client_id = public.my_client_id()
   or exists (select 1 from public.jobs j where j.supplier_id = s.id and j.client_id = public.my_client_id());
grant select on public.client_suppliers to authenticated;

-- Add (p_id null) or update one of the customer's own shippers.
create or replace function public.portal_save_shipper(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_party_client_id();
  v_company text := btrim(coalesce(p ->> 'company', ''));
  v_id uuid;
begin
  if cid is null then
    raise exception 'Only a customer portal login with Customer Party access can do this';
  end if;
  if v_company = '' then
    raise exception 'Company name is required';
  end if;
  if p_id is null then
    insert into public.suppliers (company, contact, email, phone, address, vat_no, client_id)
    values (
      v_company,
      nullif(btrim(p ->> 'contact'), ''),
      nullif(btrim(p ->> 'email'), ''),
      nullif(btrim(p ->> 'phone'), ''),
      nullif(btrim(p ->> 'address'), ''),
      nullif(btrim(p ->> 'vat_no'), ''),
      cid
    )
    returning id into v_id;
  else
    update public.suppliers set
      company = v_company,
      contact = nullif(btrim(p ->> 'contact'), ''),
      email   = nullif(btrim(p ->> 'email'), ''),
      phone   = nullif(btrim(p ->> 'phone'), ''),
      address = nullif(btrim(p ->> 'address'), ''),
      vat_no  = nullif(btrim(p ->> 'vat_no'), '')
    where id = p_id and client_id = cid
    returning id into v_id;
    if v_id is null then
      raise exception 'You can only edit your own shippers';
    end if;
  end if;
  return v_id;
end;
$$;
grant execute on function public.portal_save_shipper(uuid, jsonb) to authenticated;

-- Remove one of the customer's own shippers that nothing uses yet.
create or replace function public.portal_delete_shipper(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_party_client_id();
begin
  if cid is null then
    raise exception 'Only a customer portal login with Customer Party access can do this';
  end if;
  if not exists (select 1 from public.suppliers where id = p_id and client_id = cid) then
    raise exception 'You can only remove your own shippers';
  end if;
  if exists (select 1 from public.jobs where supplier_id = p_id)
     or exists (select 1 from public.quotes where supplier_id = p_id)
     or exists (select 1 from public.wms_receipts where supplier_id = p_id) then
    raise exception 'This shipper is on a quotation, shipment or warehouse receipt, so it stays. You can still edit its details.';
  end if;
  delete from public.suppliers where id = p_id and client_id = cid;
end;
$$;
grant execute on function public.portal_delete_shipper(uuid) to authenticated;

notify pgrst, 'reload schema';
