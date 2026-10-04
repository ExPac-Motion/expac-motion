-- 0129: an admin can create a partner-portal login with a generated
-- password (for partners who can't accept an invite link), from the
-- partner's profile. /api/partner-login (Cloudflare Pages Function, service
-- role) creates or resets the auth user, then calls this to link the login
-- to the agent / transporter / clearing agent / destination agent.
-- Only the service role can call it; it never touches a staff or customer
-- login.

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
  if me.role in ('admin', 'user', 'client') then
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
