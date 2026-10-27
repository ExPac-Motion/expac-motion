-- 0191: Mail history on a customer, lead or shipper (Customers › <customer> ›
-- Mail history, and the View window on Leads and Shippers).
--
-- Every email to or from those addresses that the Inbox holds: mail they
-- sent in, replies from the Inbox, mail sent from Outlook (Sent folder,
-- 0181) and the support@ blind copy of every Quick Mail and Shipment /
-- Quotation Comms message. Newest first, spam left out.
--
-- security invoker: inbox_messages RLS still applies, so only logins with
-- Inbox access (can_use_inbox) see anything. Read-only.
-- Self-contained & idempotent.

create or replace function public.mail_history(p_emails text[], p_limit int default 200)
returns table (
  id              uuid,
  direction       text,
  from_email      text,
  from_name       text,
  to_emails       text[],
  cc_emails       text[],
  subject         text,
  snippet         text,
  sent_at         timestamptz,
  has_attachments boolean,
  job_id          uuid
)
language sql stable security invoker set search_path = public as $$
  with addr as (
    select distinct lower(trim(x)) as a
      from unnest(coalesce(p_emails, '{}')) x
     where trim(coalesce(x, '')) like '%@%'
  ),
  hits as (
    select m.*
      from public.inbox_messages m
     where not coalesce(m.spam, false)
       and (
         lower(m.from_email) in (select a from addr)
         or exists (
           select 1 from unnest(m.to_emails || m.cc_emails) t
            where lower(trim(t)) in (select a from addr)
         )
       )
  ),
  -- The same email can be held twice (e.g. sent, then its support@ copy).
  uniq as (
    select distinct on (coalesce(h.message_id, h.id::text)) h.*
      from hits h
     order by coalesce(h.message_id, h.id::text), h.direction desc, h.sent_at
  )
  select u.id,
         -- ExPac's own copies arrive in the mailbox but were sent by ExPac.
         case when u.direction = 'out' or lower(coalesce(u.from_email, '')) like '%expac.co.za' then 'out' else 'in' end,
         u.from_email, u.from_name, u.to_emails, u.cc_emails, u.subject,
         coalesce(u.snippet, left(btrim(regexp_replace(coalesce(u.body_text, ''), '\s+', ' ', 'g')), 200)),
         u.sent_at, u.has_attachments, u.job_id
    from uniq u
   order by u.sent_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;
revoke execute on function public.mail_history(text[], int) from public, anon;
grant execute on function public.mail_history(text[], int) to authenticated;

notify pgrst, 'reload schema';

-- Check (replace with a customer's address): their last 5 emails.
-- select sent_at, direction, subject from public.mail_history(array['someone@example.com'], 5);
