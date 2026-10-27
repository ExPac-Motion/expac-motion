-- ============================================================
-- 0189  Only customers can sign up
-- ============================================================
-- Staff logins are only ever made by an Admin; nobody signs up as staff.
-- Every self sign-up is now a Customer Portal request waiting under
-- Customers › Portal Access › Awaiting approval, whichever page it came
-- from. Before this (0163) a sign-up from the sign-in page's "Create an
-- account" became a Restricted staff login that no list asked anyone to
-- approve, so customers who used it were stuck on "Access restricted".
--
--   1. handle_new_user(): a partner login only with an open partner invite
--      for that email (or when the Admin's partner-login tool links it,
--      see 3); everything else is a pending customer.
--   2. Changing a pending sign-up into staff or a partner (Settings › Team,
--      the partner tool) clears its "waiting for approval" status.
--   3. admin_link_partner_login(): may take over a fresh pending sign-up
--      (no customer linked yet), since the tool's own new login now starts
--      as one.
--   4. Restricted logins made from the sign-in page in the last 60 days,
--      not @expac.co.za and not linked to anything, move to Awaiting
--      approval.
--   5. admin_delete_login(): an Admin deletes a login from Settings › Team.
-- Self-contained & idempotent.

-- ---------- 1. New logins ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'signup_kind' = 'partner'
     and exists (
       select 1 from public.partner_invites i
        where i.claimed_at is null and lower(i.email) = lower(new.email)
     ) then
    insert into public.profiles (id, full_name, email, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      new.email,
      'partner'
    )
    on conflict (id) do nothing;
  else
    -- A customer asking for portal access; an Admin approves it (or makes
    -- it a staff login on Settings › Team).
    insert into public.profiles
      (id, full_name, email, role, portal_status, requested_company)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
      new.email,
      'client',
      'pending',
      nullif(trim(new.raw_user_meta_data ->> 'company'), '')
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- ---------- 2. Not a customer any more: not waiting for approval ----------
create or replace function public.clear_pending_when_not_client()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role <> 'client' and new.portal_status = 'pending' then
    new.portal_status := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clear_pending_when_not_client on public.profiles;
create trigger trg_clear_pending_when_not_client
  before update of role on public.profiles
  for each row execute function public.clear_pending_when_not_client();

-- ---------- 3. The Admin's partner-login tool ----------
create or replace function public.admin_link_partner_login(
  p_user uuid,
  p_kind text,
  p_partner_id uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
begin
  if p_kind not in ('agent', 'transporter', 'clearing_agent', 'destination_agent') then
    raise exception 'Unknown partner kind %', p_kind;
  end if;
  select * into me from public.profiles where id = p_user;
  if not found then
    raise exception 'No profile for that login';
  end if;
  -- A fresh sign-up still waiting (no customer linked) can become a partner.
  if me.role in ('admin', 'user')
     or (me.role = 'client' and not (me.client_id is null and me.portal_status = 'pending')) then
    raise exception 'That email already belongs to an ExPac staff or customer login';
  end if;
  if me.partner_id is not null and (me.partner_id <> p_partner_id or me.partner_kind <> p_kind) then
    raise exception 'That email is already linked to another partner';
  end if;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set role = 'partner', partner_kind = p_kind, partner_id = p_partner_id
   where id = p_user;
  perform set_config('expac.trusted_profile_update', 'off', true);
end;
$$;
revoke execute on function public.admin_link_partner_login(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_link_partner_login(uuid, text, uuid) to service_role;

-- ---------- 4. Customers who used the staff sign-up ----------
do $$
begin
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles p
     set role = 'client', portal_status = 'pending'
    from auth.users u
   where u.id = p.id
     and p.role = 'restricted'
     and p.client_id is null
     and p.partner_id is null
     and p.portal_status is null
     and coalesce(p.email, u.email, '') not ilike '%@expac.co.za'
     and u.created_at > now() - interval '60 days';
  perform set_config('expac.trusted_profile_update', 'off', true);
end $$;

-- ---------- 5. An Admin deletes a login (Settings › Team) ----------
-- Removes the login and its profile. Records the person made stay; their
-- "created by" links are cleared. Not your own login, not the last Admin.
create or replace function public.admin_delete_login(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can delete a login' using errcode = 'P0001';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can''t delete your own login' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'That is the last Admin login' using errcode = 'P0001';
  end if;
  -- The only links to a login without their own delete rule (0026).
  update public.client_invites set claimed_by = null where claimed_by = p_user;
  update public.client_invites set created_by = null where created_by = p_user;
  delete from auth.users where id = p_user;
  if not found then
    raise exception 'Login not found' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.admin_delete_login(uuid) from public, anon;
grant execute on function public.admin_delete_login(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Check: everyone now waiting for approval.
select p.full_name, p.email, p.requested_company, p.role, p.portal_status, u.created_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.portal_status = 'pending'
 order by u.created_at desc;
