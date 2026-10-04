-- 0132: deleting records is locked in the database, not just hidden in the
-- app. A staff login can delete a record only with the "delete" permission
-- (Admin always; Standard User now off by default — switch it on for the
-- role on Settings > Roles & Permissions, or for one login on Team).
--
-- A RESTRICTIVE delete policy on each record table, ANDed with the existing
-- policies. Logins that aren't staff (partner / customer portal) keep their
-- own rules (e.g. a partner's own rate sheets use "delete_sheets", 0131).
-- Child rows replaced as part of an edit (client_contacts, lead_contacts,
-- media_folders on rename) and the owner-only personal vault aren't locked.

update public.company_settings
   set role_permissions = jsonb_set(
         coalesce(role_permissions, '{}'::jsonb), '{user,delete}', 'false'::jsonb, true)
 where id = 1;

create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user":    {"rates": false, "settings": true, "crm": true, "delete": false},
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

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'suppliers', 'agents', 'transporters', 'destination_agents', 'clearing_agents',
    'quotes', 'jobs', 'ops_tasks', 'portal_announcements', 'shipment_documents',
    'leads', 'lead_statuses', 'lead_sources', 'opportunities',
    'mail_templates', 'mail_campaigns', 'media_assets', 'web_forms', 'follow_up_rules',
    'rate_sheet', 'partner_rate_structures', 'partner_rate_sheets', 'tariff_sheets'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists "delete needs permission" on public.%I', t);
    execute format(
      'create policy "delete needs permission" on public.%I as restrictive
         for delete to authenticated
         using (public.has_perm(''delete'') or not public.is_staff())', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
