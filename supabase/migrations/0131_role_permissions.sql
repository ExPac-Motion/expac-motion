-- 0131: roles & permissions.
--   Roles: Admin User (everything, fixed) / Standard User / Partner Portal
--   User / Customer Portal. Each role's permissions are set on Settings >
--   Roles & Permissions (company_settings.role_permissions); a single login
--   can be given more or less on Settings > Team (profiles.permissions,
--   per-user override). Customer Portal keeps its per-login
--   portal_permissions; the role settings are the defaults for new logins.
--
--   Standard User:       rates (Rates & Tariff, partner rate sheets, buy
--                        rates — enforced here), settings, crm (sales
--                        dashboard / financials), delete (records).
--   Partner Portal User: delete_sheets, edit_coverage, see_history — all
--                        enforced here.

-- ---------- 1. Storage ----------
alter table public.company_settings
  add column if not exists role_permissions jsonb not null default '{
    "user":    {"rates": false, "settings": true, "crm": true, "delete": true},
    "partner": {"delete_sheets": false, "edit_coverage": false, "see_history": false},
    "client":  {"shipments": true, "quotes": true, "invoices": true, "suppliers": true, "rates": true, "messaging": true}
  }'::jsonb;

alter table public.profiles
  add column if not exists permissions jsonb;

-- ---------- 2. Nobody grants themselves permissions ----------
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin()
     and coalesce(current_setting('expac.trusted_profile_update', true), '') <> 'on' then
    new.role := old.role;
    new.client_id := old.client_id;
    new.portal_status := old.portal_status;
    new.portal_permissions := old.portal_permissions;
    new.partner_kind := old.partner_kind;
    new.partner_id := old.partner_id;
    new.permissions := old.permissions;
  end if;
  return new;
end;
$$;

-- Only an admin changes role permissions / tier margins, even if a
-- Standard User may edit other company settings.
create or replace function public.protect_company_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role_permissions := old.role_permissions;
    new.tier_margins := old.tier_margins;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_company_privileges on public.company_settings;
create trigger trg_protect_company_privileges
  before update on public.company_settings
  for each row execute function public.protect_company_privileges();

-- ---------- 3. Effective permissions ----------
-- Admin: always true. Standard User / Partner Portal User: the login's own
-- override, else the role setting, else the built-in default.
create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user":    {"rates": false, "settings": true, "crm": true, "delete": true},
    "partner": {"delete_sheets": false, "edit_coverage": false, "see_history": false}
  }'::jsonb;
  settings jsonb;
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
grant execute on function public.has_perm(text) to authenticated;

-- The signed-in login's effective permissions, for the app to show / hide.
create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rates', public.has_perm('rates'),
    'settings', public.has_perm('settings'),
    'crm', public.has_perm('crm'),
    'delete', public.has_perm('delete'),
    'delete_sheets', public.has_perm('delete_sheets'),
    'edit_coverage', public.has_perm('edit_coverage'),
    'see_history', public.has_perm('see_history')
  );
$$;
grant execute on function public.my_permissions() to authenticated;

-- ---------- 4. Rates & buy prices: admin, or staff with "rates" ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'rate_sheet', 'partner_rate_structures', 'partner_rate_sheets', 'tariff_sheets'
  ]
  loop
    execute format('drop policy if exists "admin only" on public.%I', t);
    execute format('drop policy if exists "admin or rates permission" on public.%I', t);
    execute format(
      'create policy "admin or rates permission" on public.%I for all to authenticated
         using (public.is_admin() or (public.is_staff() and public.has_perm(''rates'')))
         with check (public.is_admin() or (public.is_staff() and public.has_perm(''rates'')))', t);
  end loop;
end;
$$;

-- ---------- 5. Partner portal switches ----------
drop policy if exists "partner deletes own" on public.partner_rate_sheets;
create policy "partner deletes own" on public.partner_rate_sheets
  for delete to authenticated
  using (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id()
         and public.has_perm('delete_sheets'));

drop policy if exists "admin only" on public.partner_rate_sheet_history;
drop policy if exists "history readers" on public.partner_rate_sheet_history;
create policy "history readers" on public.partner_rate_sheet_history
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and public.has_perm('rates'))
    or (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id()
        and public.has_perm('see_history'))
  );

-- A partner login updates its own coverage (modes / countries / ports /
-- notes) — nothing else on its record.
create or replace function public.update_my_coverage(
  p_modes text[], p_countries text[], p_ports text[], p_notes text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  tbl text;
begin
  if k is null or p is null or not public.has_perm('edit_coverage') then
    raise exception 'Your login can''t change your coverage — ask ExPac';
  end if;
  tbl := case k
    when 'agent' then 'agents'
    when 'transporter' then 'transporters'
    when 'clearing_agent' then 'clearing_agents'
    when 'destination_agent' then 'destination_agents'
  end;
  execute format(
    'update public.%I set modes = $1, countries = $2, ports = $3, coverage_notes = $4 where id = $5',
    tbl)
  using coalesce(p_modes, '{}'), coalesce(p_countries, '{}'), coalesce(p_ports, '{}'),
        nullif(trim(coalesce(p_notes, '')), ''), p;
end;
$$;
grant execute on function public.update_my_coverage(text[], text[], text[], text) to authenticated;

-- my_partner() also returns ports + notes so the portal can edit coverage.
drop function if exists public.my_partner();
create function public.my_partner()
returns table (partner_kind text, partner_id uuid, company text, modes text[], countries text[],
               ports text[], coverage_notes text)
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  j jsonb;
begin
  if k is null or p is null then
    return;
  end if;
  j := case k
    when 'agent' then (select to_jsonb(a) from public.agents a where a.id = p)
    when 'transporter' then (select to_jsonb(t) from public.transporters t where t.id = p)
    when 'clearing_agent' then (select to_jsonb(c) from public.clearing_agents c where c.id = p)
    when 'destination_agent' then (select to_jsonb(d) from public.destination_agents d where d.id = p)
  end;
  return query select k, p, public.partner_company(k, p),
    coalesce(public.partner_modes(k, p), '{}'),
    coalesce(public.partner_countries(k, p), '{}'),
    coalesce(array(select jsonb_array_elements_text(
      case when jsonb_typeof(j -> 'ports') = 'array' then j -> 'ports' else '[]'::jsonb end)), '{}'),
    j ->> 'coverage_notes';
end;
$$;
grant execute on function public.my_partner() to authenticated;

-- ---------- 6. Customer Portal defaults for new logins ----------
create or replace function public.default_portal_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
begin
  select role_permissions -> 'client' into d from public.company_settings where id = 1;
  if jsonb_typeof(d) = 'object' then
    new.portal_permissions := coalesce(new.portal_permissions, '{}'::jsonb) || d;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_default_portal_permissions on public.profiles;
create trigger trg_default_portal_permissions
  before insert on public.profiles
  for each row execute function public.default_portal_permissions();

notify pgrst, 'reload schema';
