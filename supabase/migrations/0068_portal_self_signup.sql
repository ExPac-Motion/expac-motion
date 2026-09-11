-- ============================================================
-- 0068  Customer Portal: self-serve signup with staff approval
-- ============================================================
-- Adds a second way to provision a portal login, alongside the existing
-- staff-issued invite link (0026): a prospective customer can request an
-- account directly from the signup page with no invite. Unlike the old
-- default signup path (handle_new_user() -> role defaults to 'user', which
-- is_staff() treats as full staff access), a self-serve request is created
-- with role='client' and portal_status='pending' from the very first
-- instant the auth user exists -- there is no window where the new
-- account holds staff-level access, even briefly.
--
-- A pending account can sign in, but the app shows only a "waiting on
-- approval" screen (see PortalProtected in App.tsx) until staff runs
-- approve_portal_signup(), which links it to a real client_id.
--
-- Run in the Supabase SQL editor after 0067. Self-contained & idempotent.

alter table public.profiles
  add column if not exists portal_status text;
alter table public.profiles drop constraint if exists profiles_portal_status_check;
alter table public.profiles add constraint profiles_portal_status_check
  check (portal_status is null or portal_status in ('pending', 'approved', 'rejected'));

alter table public.profiles
  add column if not exists requested_company text;

-- profiles never stored an email before -- getMyProfile() filled it in
-- client-side from the current session for "me" only. Staff reviewing
-- OTHER people's pending signups need to see it server-side too.
alter table public.profiles
  add column if not exists email text;
update public.profiles p
   set email = u.email
  from auth.users u
 where p.id = u.id and p.email is null;

-- ---------- handle_new_user: branch on a self-serve portal signup ----------
-- signUp() passes { data: { signup_kind: 'portal', full_name, company } } for
-- the customer-facing form; every other signup (staff, or a staff-issued
-- invite claim) is untouched and keeps defaulting to role='user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'signup_kind' = 'portal' then
    insert into public.profiles
      (id, full_name, email, role, portal_status, requested_company)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      new.email,
      'client',
      'pending',
      nullif(trim(new.raw_user_meta_data ->> 'company'), '')
    )
    on conflict (id) do nothing;
  else
    insert into public.profiles (id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- ---------- lock portal_status the same way role/client_id are locked ----------
-- Without this, "profiles update" (id = auth.uid()) would let a pending
-- client just set their own portal_status = 'approved'.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.role := old.role;
    new.client_id := old.client_id;
    new.portal_status := old.portal_status;
  end if;
  return new;
end;
$$;

-- ---------- staff approves/rejects a pending signup ----------
create or replace function public.approve_portal_signup(p_profile_id uuid, p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorised';
  end if;
  update public.profiles
     set role = 'client', client_id = p_client_id, portal_status = 'approved'
   where id = p_profile_id;
end;
$$;

create or replace function public.reject_portal_signup(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Not authorised';
  end if;
  update public.profiles set portal_status = 'rejected' where id = p_profile_id;
end;
$$;

-- Keep the older invite-claim path consistent with the new status column
-- (NULL from before this migration is still treated as "approved" by the
-- app, so existing portal clients are unaffected either way).
create or replace function public.claim_client_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from public.client_invites
   where token = p_token and claimed_at is null;
  if v_client_id is null then
    raise exception 'Invalid or already-used invite link';
  end if;
  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where token = p_token;
  update public.profiles
     set role = 'client', client_id = v_client_id, portal_status = 'approved'
   where id = auth.uid();
end;
$$;
