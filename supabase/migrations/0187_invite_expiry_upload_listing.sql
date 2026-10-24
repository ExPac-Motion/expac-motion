-- ============================================================
-- 0187  Portal invites expire; public form uploads can't be listed
-- ============================================================
-- 1. Customer portal invites never expired: a link sent a year ago still
--    created a login. Unclaimed invites now stop working 30 days after they
--    were created (staff simply send a new one from Portal Access / the
--    customer record).
--
-- 2. web-form-uploads (images people attach on the public web forms) had a
--    public SELECT policy, so anyone could LIST every uploaded file through
--    the storage API. The bucket is public and the app opens files by their
--    random public URL, which needs no policy, so the listing policy goes.
--
-- Run in the Supabase SQL editor after 0186. Idempotent.

-- ---------- 1. Invites: 30 days ----------
-- Claimed invites are still returned (the page then says "already used").
create or replace function public.check_client_invite(p_token uuid)
returns table (email text, claimed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.email, i.claimed_at
    from public.client_invites i
   where i.token = p_token
     and (i.claimed_at is not null or i.created_at > now() - interval '30 days');
$$;
revoke execute on function public.check_client_invite(uuid) from public;
grant execute on function public.check_client_invite(uuid) to anon, authenticated;

create or replace function public.claim_client_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv public.client_invites%rowtype;
  me  public.profiles%rowtype;
begin
  select * into inv from public.client_invites where token = p_token and claimed_at is null;
  if inv.token is null then
    raise exception 'Invalid or already-used invite link';
  end if;
  if inv.created_at <= now() - interval '30 days' then
    raise exception 'This invite link has expired, ask ExPac for a new one';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'client' or me.client_id is not null then
    raise exception 'This invite can only be used by a new customer portal login';
  end if;
  if coalesce(trim(inv.email), '') <> ''
     and lower(trim(inv.email)) <> lower(trim(coalesce(me.email, ''))) then
    raise exception 'This invite was sent to a different email address, sign up with %', inv.email;
  end if;
  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where token = p_token;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set role = 'client', client_id = inv.client_id, portal_status = 'approved'
   where id = auth.uid();
  perform set_config('expac.trusted_profile_update', 'off', true);
end;
$$;
revoke execute on function public.claim_client_invite(uuid) from public, anon;
grant execute on function public.claim_client_invite(uuid) to authenticated;

-- ---------- 2. Public form uploads: no listing ----------
drop policy if exists "web-form-uploads public read" on storage.objects;

notify pgrst, 'reload schema';
