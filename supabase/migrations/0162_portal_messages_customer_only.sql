-- ============================================================
-- 0162  Portal shipment messages: only mail between ExPac and the customer
-- ============================================================
-- client_messages (0026) showed the customer EVERY email on its shipment,
-- including mail from the shipment's partner dialog to agents /
-- transporters / clearing agents and their replies (logged on the same
-- thread). Now an email shows on the portal only when:
--   * the customer sent it (portal chat: no from_email; or a reply from one
--     of the customer's addresses / its company email domain), or
--   * ExPac sent it to (or cc'd) one of the customer's addresses / domain.
-- Customer addresses = the customer's email, its contacts' emails and its
-- portal logins. Free-mail domains (gmail, outlook ...) never count as a
-- company domain, only the exact address does.
--
-- Run in the Supabase SQL editor after 0161. Self-contained & idempotent.

create or replace function public.customer_mail_match(p_client uuid, p_addr text)
returns boolean language sql stable security definer set search_path = public as $$
  with a as (
    select lower(btrim(coalesce(substring(p_addr from '<([^>]+)>'), p_addr))) as addr
  ),
  known as (
    select lower(btrim(c.email)) as e from public.clients c where c.id = p_client and c.email is not null
    union select lower(btrim(cc.email)) from public.client_contacts cc where cc.client_id = p_client and cc.email is not null
    union select lower(btrim(u.email)) from public.profiles p join auth.users u on u.id = p.id
      where p.client_id = p_client and p.role = 'client' and u.email is not null
  ),
  domains as (
    select distinct split_part(e, '@', 2) as d from known
    where split_part(e, '@', 2) not in (
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com',
      'icloud.com', 'me.com', 'aol.com', 'mweb.co.za', 'telkomsa.net', 'webmail.co.za', 'vodamail.co.za',
      'qq.com', '163.com', '126.com', 'expac.co.za'
    ) and split_part(e, '@', 2) <> ''
  )
  select exists (select 1 from a, known where a.addr = known.e)
      or exists (select 1 from a, domains where split_part(a.addr, '@', 2) = domains.d);
$$;
revoke all on function public.customer_mail_match(uuid, text) from public;

create or replace view public.client_messages
with (security_barrier = true) as
select m.id, m.job_id, m.direction, m.to_emails, m.cc_emails, m.subject,
       m.body, m.status, m.created_at
from public.messages m
join public.jobs j on j.id = m.job_id
where j.client_id = public.my_client_id()
  and m.kind = 'email'
  and (
    (m.direction = 'in'
      and (m.from_email is null or public.customer_mail_match(j.client_id, m.from_email)))
    or (m.direction = 'out'
      and exists (
        select 1 from unnest(coalesce(m.to_emails, '{}') || coalesce(m.cc_emails, '{}')) as r(addr)
        where public.customer_mail_match(j.client_id, r.addr)
      ))
  );
grant select on public.client_messages to authenticated;

notify pgrst, 'reload schema';
