-- 0145: the customer edits its own company details from the portal (top-right
-- company name) — written straight onto its clients row, so the customer
-- record in Motion stays in sync.
--   Company Name -> company          Email Address -> email
--   Registration Number -> registration_no   Tel Number -> company_phone
--   Vat Number -> vat_no             Mobile Number -> contact_mobile
--   Customs Import number -> import_code
--   Company Address -> address       Delivery Address -> physical_address

alter table public.clients
  add column if not exists portal_updated_at timestamptz;

-- The customer's own company card, now with the editable details (appended columns).
create or replace view public.client_me
with (security_barrier = true) as
select c.id, c.company, c.contact, c.email, c.phone, c.address,
       sp.full_name as account_manager,
       c.registration_no, c.vat_no, c.import_code, c.company_phone, c.contact_mobile,
       c.physical_address, c.portal_updated_at
from public.clients c
left join public.profiles sp on sp.id = c.sales_person_id
where c.id = public.my_client_id();
grant select on public.client_me to authenticated;

create or replace function public.portal_update_company(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
begin
  if cid is null then
    raise exception 'Only a customer portal login can update company details';
  end if;
  if coalesce(trim(p ->> 'company'), '') = '' then
    raise exception 'Company name is required';
  end if;
  update public.clients set
    company          = trim(p ->> 'company'),
    registration_no  = nullif(trim(p ->> 'registration_no'), ''),
    vat_no           = nullif(trim(p ->> 'vat_no'), ''),
    import_code      = nullif(trim(p ->> 'import_code'), ''),
    email            = nullif(trim(p ->> 'email'), ''),
    company_phone    = nullif(trim(p ->> 'company_phone'), ''),
    contact_mobile   = nullif(trim(p ->> 'contact_mobile'), ''),
    address          = nullif(trim(p ->> 'address'), ''),
    physical_address = nullif(trim(p ->> 'physical_address'), ''),
    portal_updated_at = now()
  where id = cid;
end;
$$;
grant execute on function public.portal_update_company(jsonb) to authenticated;
