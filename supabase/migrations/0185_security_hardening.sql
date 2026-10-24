-- ============================================================
-- 0185  Security hardening (system check, Oct 2026)
-- ============================================================
-- 1. Portal invites were readable by ANYONE (the public anon key, no
--    login): "anon read unclaimed invite" let a single REST call list every
--    unclaimed invite's token, customer and email. A token + the open
--    signup page = an approved portal login on that customer, seeing its
--    shipments, quotes, invoices and documents.
--    Now: no table read at all outside staff. The signup page checks ONE
--    token through check_client_invite(), which only says whether that
--    exact token is open and who it was sent to.
--
-- 2. claim_client_invite() accepted any signed-in caller. Now only a new,
--    not-yet-linked portal login can claim, and when the invite names an
--    email it must be the caller's own (same rule partner invites have).
--
-- 3. is_staff() treated a login with NO profile row as staff (coalesce
--    ..., true). Now no profile = not staff.
--
-- 4. inbox_sender_match() told anyone, even without a login, whether an
--    email / domain is a customer, lead or supplier (and its name). Now
--    staff (and the server sync) only. inbox_find_job() and
--    process_scheduled_campaigns() lose direct execute (database-internal).
--
-- 5. Customers › Portal Access gets a menu count of signups waiting.
--
-- Run in the Supabase SQL editor after 0184. Self-contained & idempotent.

-- ---------- 1. Invites: no public read ----------
drop policy if exists "anon read unclaimed invite" on public.client_invites;

create or replace function public.check_client_invite(p_token uuid)
returns table (email text, claimed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.email, i.claimed_at from public.client_invites i where i.token = p_token;
$$;
revoke execute on function public.check_client_invite(uuid) from public;
grant execute on function public.check_client_invite(uuid) to anon, authenticated;

-- ---------- 2. Claiming: a fresh portal login, the invited email ----------
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

-- ---------- 3. No profile row = not staff ----------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.in_portal_preview() then false
    else coalesce(
      (select role in ('admin', 'user') from public.profiles where id = auth.uid()),
      false
    )
  end;
$$;

-- ---------- 4. Inbox / campaign helpers: not callable by customers ----------
-- inbox_sender_match() answered anyone (default PUBLIC execute, even the
-- anon key): give it an email or domain and it said which customer, lead or
-- supplier that is. The staff Inbox (a security_invoker view) still needs
-- it, so it gets a staff guard instead of a revoke.
create or replace function public.inbox_sender_match(p_email text)
returns table (category text, record_kind text, record_id uuid, record_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  d text := split_part(lower(trim(coalesce(p_email, ''))), '@', 2);
  pass int;
begin
  -- 0185: only staff (the Inbox) or the server sync may look senders up; a
  -- customer / anonymous caller can not probe who is on file.
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_staff() then
    return query select 'unknown'::text, null::text, null::uuid, null::text;
    return;
  end if;
  if e = '' or position('@' in e) = 0 then
    return query select 'unknown'::text, null::text, null::uuid, null::text;
    return;
  end if;
  -- ExPac's own mail (expac.co.za or a subdomain such as send.expac.co.za)
  -- is Internal — even if a CRM record happens to carry an ExPac address.
  if d = 'expac.co.za' or d like '%.expac.co.za' then
    return query select 'internal'::text, null::text, null::uuid, 'ExPac'::text;
    return;
  end if;
  -- pass 1: exact email; pass 2: same company domain
  for pass in 1..2 loop
    if pass = 2 and (d = '' or public.inbox_public_domain(d)) then
      exit;
    end if;
    -- Customers
    return query
      select 'customer', 'client', c.id, c.company from public.clients c
       where (pass = 1 and lower(c.email) = e) or (pass = 2 and split_part(lower(c.email), '@', 2) = d)
      union all
      select 'customer', 'client', c.id, c.company
        from public.client_contacts cc join public.clients c on c.id = cc.client_id
       where (pass = 1 and lower(cc.email) = e) or (pass = 2 and split_part(lower(cc.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Suppliers & Agents
    return query
      select x.cat, x.kind, x.id, x.company from (
        select 'partner'::text as cat, 'supplier'::text as kind, s.id, s.company, s.email from public.suppliers s
        union all select 'partner', 'agent', a.id, a.company, a.email from public.agents a
        union all select 'partner', 'transporter', t.id, t.company, t.email from public.transporters t
        union all select 'partner', 'clearing_agent', ca.id, ca.company, ca.email from public.clearing_agents ca
        union all select 'partner', 'destination_agent', da.id, da.company, da.email from public.destination_agents da
      ) x
       where (pass = 1 and lower(x.email) = e) or (pass = 2 and split_part(lower(x.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Leads (not yet customers)
    return query
      select 'lead', 'lead', l.id, l.company from public.leads l
       where l.promoted_client_id is null
         and ((pass = 1 and lower(l.email) = e) or (pass = 2 and split_part(lower(l.email), '@', 2) = d))
      union all
      select 'lead', 'lead', l.id, l.company
        from public.lead_contacts lc join public.leads l on l.id = lc.lead_id
       where l.promoted_client_id is null
         and ((pass = 1 and lower(lc.email) = e) or (pass = 2 and split_part(lower(lc.email), '@', 2) = d))
      limit 1;
    if found then return; end if;
  end loop;
  return query select 'unknown'::text, null::text, null::uuid, null::text;
end;
$$;

revoke execute on function public.inbox_sender_match(text) from public, anon;
grant execute on function public.inbox_sender_match(text) to authenticated, service_role;

-- Only ever called from inside the database (the inbox trigger, pg_cron).
revoke execute on function public.inbox_find_job(text) from public, anon, authenticated;
revoke execute on function public.process_scheduled_campaigns() from public, anon, authenticated;

-- ---------- 5. Menu count: portal signups waiting for approval ----------
-- The "new signup" email only goes out when the customer clicks Continue on
-- the signup page; one who confirms from the email link never triggers it.
-- Customers › Portal Access now carries a count either way (staff only,
-- RLS: is_staff() sees every profile).
create or replace function public.nav_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'jobs_active',     (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered'),
    'jobs_air',        (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Air%'),
    'jobs_courier',    (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Courier%'),
    'jobs_sea',        (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Sea%'),
    'jobs_road',       (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Road%'),
    'quotes_open',     (select count(*) from public.quotes q where q.status = 'open'),
    'quotes_sent',     (select count(*) from public.quotes q where q.status = 'sent'),
    'quotes_accepted', (select count(*) from public.quotes q where q.status = 'accepted'),
    'tasks_open',      (select count(*) from public.ops_tasks t where t.status <> 'done'),
    'chat_unread',     (select count(*) from public.client_chat c where c.direction = 'in' and c.read_at is null),
    'portal_pending',  (select count(*) from public.profiles p where p.portal_status = 'pending' and public.is_staff())
  );
$$;
grant execute on function public.nav_counts() to authenticated;

notify pgrst, 'reload schema';

-- ---------- Checks (read-only) ----------
-- Portal signups from the last 7 days and where each stands
-- (pending = should be under Customers › Portal Access › Awaiting approval):
select p.full_name, p.email, p.requested_company, p.role, p.portal_status,
       p.client_id is not null as linked_to_customer, u.created_at, u.email_confirmed_at, u.last_sign_in_at
  from public.profiles p join auth.users u on u.id = p.id
 where u.created_at > now() - interval '7 days'
 order by u.created_at desc;

-- Logins with no profile row (were treated as staff before this fix):
select u.id, u.email, u.created_at
  from auth.users u left join public.profiles p on p.id = u.id
 where p.id is null;

-- Invites still open, oldest first (consider deleting old ones in Portal Access):
select i.created_at::date, c.company, i.email
  from public.client_invites i join public.clients c on c.id = i.client_id
 where i.claimed_at is null
 order by i.created_at;
