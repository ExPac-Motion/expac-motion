-- ============================================================
-- 0122  Partner portal: link a confirmed login to its invite on sign-in
-- ============================================================
-- A partner who confirms their email from the link (instead of returning
-- to the signup tab and clicking Continue) arrives signed in but not yet
-- linked to their agent / transporter / clearing agent. On the portal,
-- claim_my_partner_invite() links them to the open invite sent to their own
-- email address — the same rule claim_partner_invite enforces (fresh
-- role='partner' login, matching email). Signing in at all requires the
-- address to be confirmed, so this proves they own that mailbox.
--
-- Run in the Supabase SQL editor after 0121. Self-contained & idempotent.

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
  update public.profiles
     set partner_kind = inv.partner_kind, partner_id = inv.partner_id
   where id = auth.uid();
  return true;
end;
$$;
grant execute on function public.claim_my_partner_invite() to authenticated;

notify pgrst, 'reload schema';
