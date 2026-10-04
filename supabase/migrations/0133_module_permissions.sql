-- 0133: every Motion area is its own Standard User permission (Settings >
-- Team > Access checklist, Settings > Roles & Permissions): Control Tower,
-- Shipments, Quotations, Customs Charges, Customers, Suppliers & partners,
-- Sales CRM leads & outreach — on by default (today's access). Joins the
-- 0131 switches (rates, settings, crm, delete).

create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user": {
      "ops": true, "shipments": true, "quotes": true, "customs": true, "customers": true,
      "suppliers": true, "leads": true,
      "rates": false, "settings": true, "crm": true, "delete": false
    },
    "partner": {"delete_sheets": false, "edit_coverage": false, "see_history": false}
  }'::jsonb;
  v text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    return false;
  end if;
  if me.role = 'admin' then
    return true;
  end if;
  role_key := case
    when me.role = 'user' then 'user'
    when me.role = 'partner' and me.partner_id is not null then 'partner'
  end;
  if role_key is null then
    return false;
  end if;
  v := me.permissions ->> p_key;
  if v is null then
    select role_permissions -> role_key ->> p_key into v from public.company_settings where id = 1;
  end if;
  if v is null then
    v := defaults -> role_key ->> p_key;
  end if;
  return coalesce(v::boolean, false);
end;
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, public.has_perm(k))
  from unnest(array[
    'ops', 'shipments', 'quotes', 'customs', 'customers', 'suppliers', 'leads',
    'rates', 'settings', 'crm', 'delete',
    'delete_sheets', 'edit_coverage', 'see_history'
  ]) as k;
$$;
grant execute on function public.my_permissions() to authenticated;
