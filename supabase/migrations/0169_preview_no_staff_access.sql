-- ============================================================
-- 0169  Portal preview: the admin sees ONLY the previewed customer
-- ============================================================
-- Fix for 0167. While previewing, the portal's own views showed the
-- previewed customer (my_client_id()), but tables the portal reads
-- directly (warehouse receipts, releases, pre-advices, invoices, General
-- chat ...) also have a staff policy, and the admin's staff access showed
-- EVERY customer's rows there (e.g. Carbon Hub's receipts on Empire
-- Salon's preview).
-- Now an admin with a preview running has no staff access at all
-- (is_staff / has_perm / can_see_accounts are false) until the preview
-- ends (Exit preview, or 2 hours): the database then only gives them what
-- the previewed customer could see. Motion shows no data meanwhile.
-- Starting / stopping a preview (is_admin) is unaffected.
--
-- Run in the Supabase SQL editor after 0168. Self-contained & idempotent.

-- True while the signed-in admin is previewing a customer.
create or replace function public.in_portal_preview()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
       and p.preview_client_id is not null and p.preview_until > now()
  );
$$;
grant execute on function public.in_portal_preview() to authenticated;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.in_portal_preview() then false
    else coalesce(
      (select role in ('admin', 'user') from public.profiles where id = auth.uid()),
      true
    )
  end;
$$;

create or replace function public.can_see_accounts()
returns boolean language sql stable security definer set search_path = public as $$
  select not public.in_portal_preview() and exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'user')
  );
$$;

create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user": {
      "ops": true, "shipments": true, "quotes": true, "warehouse": true, "customs": true,
      "customers": true, "suppliers": true, "leads": true, "inbox": false,
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
    -- No staff permissions while previewing a customer's portal (0169).
    return not (me.preview_client_id is not null and me.preview_until > now());
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

notify pgrst, 'reload schema';
