-- ============================================================
-- 0123  Invite claims can set the login's link again
-- ============================================================
-- protect_profile_privileges (0091 / 0121) reverts role / client_id /
-- partner_kind / partner_id on any profile update by a non-admin — right for
-- a plain profiles UPDATE, but it also reverted the claim functions' own
-- update (they run as the claiming customer / partner, who isn't admin), so
-- an invite claim never actually linked the login:
--   * claim_client_invite   — customer invite links (since 0091)
--   * claim_partner_invite / claim_my_partner_invite — partner logins (0121/0122)
--
-- Fix: the claim functions mark their own transaction as trusted
-- (set_config(..., is_local => true)); the trigger lets privileged columns
-- change only then or for an admin. Clients can't set this flag themselves —
-- PostgREST only exposes functions in the public schema, and each request is
-- its own transaction.
--
-- Run in the Supabase SQL editor after 0122. Self-contained & idempotent.

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
  end if;
  return new;
end;
$$;

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
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set role = 'client', client_id = v_client_id, portal_status = 'approved'
   where id = auth.uid();
  perform set_config('expac.trusted_profile_update', 'off', true);
end;
$$;

create or replace function public.claim_partner_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv public.partner_invites%rowtype;
  me  public.profiles%rowtype;
begin
  select * into inv from public.partner_invites where token = p_token and claimed_at is null;
  if inv.token is null then
    raise exception 'Invalid or already-used invite link';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'partner' or me.partner_id is not null then
    raise exception 'This invite can only be used by a new partner login';
  end if;
  if lower(coalesce(me.email, '')) <> lower(inv.email) then
    raise exception 'This invite was sent to %. Sign up with that email address.', inv.email;
  end if;
  update public.partner_invites set claimed_by = auth.uid(), claimed_at = now() where token = p_token;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles set partner_kind = inv.partner_kind, partner_id = inv.partner_id
   where id = auth.uid();
  perform set_config('expac.trusted_profile_update', 'off', true);
end;
$$;

create or replace function public.claim_my_partner_invite()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  me  public.profiles%rowtype;
  inv public.partner_invites%rowtype;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'partner' or me.partner_id is not null
     or coalesce(me.email, '') = '' then
    return false;
  end if;
  select * into inv from public.partner_invites
   where claimed_at is null and lower(email) = lower(me.email)
   order by created_at desc
   limit 1;
  if inv.token is null then
    return false;
  end if;
  update public.partner_invites set claimed_by = auth.uid(), claimed_at = now()
   where token = inv.token;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set partner_kind = inv.partner_kind, partner_id = inv.partner_id
   where id = auth.uid();
  perform set_config('expac.trusted_profile_update', 'off', true);
  return true;
end;
$$;

notify pgrst, 'reload schema';
