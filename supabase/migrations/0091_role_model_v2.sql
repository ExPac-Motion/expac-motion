-- ============================================================
-- 0091  Role model v2: admin / user / client / restricted
-- ============================================================
-- Formalises four distinct tiers (previously "anything not literally
-- role='client' is staff", which is what let a mis-provisioned portal
-- account silently get full internal access — see the 2026-09-15 incident
-- with gilbert@connell.co.za):
--
--   admin      - full access, and the only role that can manage other
--                users' roles/client links/portal status/permissions.
--   user       - "Standard User" / salesperson: same data access as
--                admin today, just can't manage other users.
--   client     - customer portal login, scoped to their own client_id.
--   restricted - explicitly locked out of both the internal app and the
--                portal. Used both to revoke a portal client's access
--                (client_id is kept so it can be restored) and to lock
--                out a former staff member without deleting their login.
--
-- Also fixes a second, related gap found while designing this: the
-- client_* portal views only ever checked `client_id = my_client_id()`,
-- and my_client_id() returned a profile's client_id regardless of role —
-- so a 'restricted' (or any non-client) profile that still had a
-- client_id set would still see that client's quotes/jobs/messages via
-- the portal views. my_client_id() now requires role='client' too.
--
-- Run in the Supabase SQL editor after 0090. Self-contained & idempotent.

-- ---------- 1. Role constraint ----------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'user', 'client', 'restricted'));

-- ---------- 2. Per-client-portal-login section permissions ----------

alter table public.profiles
  add column if not exists portal_permissions jsonb not null default
    '{"shipments": true, "quotes": true, "invoices": true, "suppliers": true, "rates": true, "messaging": true}'::jsonb;

-- ---------- 3. is_staff() — explicit allow-list, not "anything but client" ----------

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('admin', 'user') from public.profiles where id = auth.uid()),
    true -- no profile row yet (mid-signup race for a legitimate staff login,
         -- e.g. the trigger hasn't run yet) — every portal signup path
         -- (0068, and the invite path fixed alongside this migration)
         -- inserts its profile row as role='client' from the very first
         -- instant the auth user exists, so this default is never hit by
         -- a portal account any more.
  );
$$;

-- ---------- 4. is_admin() — the "one user: me" tier ----------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false -- unlike is_staff(), never default an ambiguous/missing profile
          -- to admin — admin is granted explicitly, never assumed.
  );
$$;

-- ---------- 5. my_client_id() now requires role='client' ----------

create or replace function public.my_client_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid() and role = 'client';
$$;

-- ---------- 6. Only admins can change role/client_id/portal_status/permissions ----------
-- Previously this only blocked non-staff (i.e. clients) from touching their
-- own privilege columns; any Standard User could already promote anyone
-- (including themselves) to admin, or approve a client, via a plain
-- profiles UPDATE. Now it takes an explicit admin.

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.client_id := old.client_id;
    new.portal_status := old.portal_status;
    new.portal_permissions := old.portal_permissions;
  end if;
  return new;
end;
$$;

-- ---------- 7. Portal signup approval is admin-only too ----------

create or replace function public.approve_portal_signup(p_profile_id uuid, p_client_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
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
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  update public.profiles set portal_status = 'rejected' where id = p_profile_id;
end;
$$;

-- ---------- 8. Revoke / restore / permission-toggle a portal login ----------

create or replace function public.revoke_portal_access(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  update public.profiles set role = 'restricted' where id = p_profile_id;
end;
$$;

create or replace function public.restore_portal_access(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  update public.profiles
     set role = 'client'
   where id = p_profile_id and client_id is not null;
end;
$$;

create or replace function public.set_portal_permissions(p_profile_id uuid, p_permissions jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  update public.profiles set portal_permissions = p_permissions where id = p_profile_id;
end;
$$;

-- ---------- 9. Admin-only listing of every portal-related profile ----------
-- Includes auth.users.last_sign_in_at, which PostgREST can't expose
-- directly — this is the only sanctioned way to surface it, gated to
-- is_admin() rather than relying on RLS on a view over auth.users.

create or replace function public.list_portal_users()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  client_id uuid,
  company text,
  portal_status text,
  portal_permissions jsonb,
  requested_company text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  return query
    select p.id, p.full_name, p.email, p.role, p.client_id, c.company,
           p.portal_status, p.portal_permissions, p.requested_company,
           p.created_at, u.last_sign_in_at
    from public.profiles p
    left join public.clients c on c.id = p.client_id
    left join auth.users u on u.id = p.id
    where p.client_id is not null or p.portal_status is not null
    order by p.created_at desc;
end;
$$;
