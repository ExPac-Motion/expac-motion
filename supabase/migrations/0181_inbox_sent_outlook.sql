-- 0181: Inbox › Sent shows mail sent from Outlook. /api/inbox-sync now also
-- reads the mailbox's Sent folder (stored as direction 'out', mailbox
-- 'support:sent'); here those rows are labelled 'outlook' instead of
-- 'inbox'. Otherwise the same view as 0136.

drop view if exists public.inbox_sent_v;
create view public.inbox_sent_v with (security_invoker = true) as
  select m.id,
         case when m.mailbox like '%:sent' then 'outlook' else 'inbox' end::text as source,
         m.to_emails, m.cc_emails, m.subject,
         coalesce(m.snippet, '') as preview, m.body_html as body,
         m.sent_at, coalesce(m.delivery_status, case when m.provider_id is null then 'saved' else 'sent' end) as status,
         null::text as error, m.job_id, j.reference as job_reference, null::uuid as quote_id, null::text as quote_reference
    from public.inbox_messages m
    left join public.jobs j on j.id = m.job_id
   where m.direction = 'out'
  union all
  select ms.id, 'shipment', ms.to_emails, ms.cc_emails, ms.subject,
         left(btrim(regexp_replace(regexp_replace(coalesce(ms.body, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')), 180),
         ms.body, coalesce(ms.sent_at, ms.created_at), ms.status::text, ms.error,
         ms.job_id, j.reference, null::uuid, null::text
    from public.messages ms
    left join public.jobs j on j.id = ms.job_id
   where ms.direction = 'out'
  union all
  select qm.id, 'quote', qm.to_emails, qm.cc_emails, qm.subject,
         left(btrim(regexp_replace(regexp_replace(coalesce(qm.body, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')), 180),
         qm.body, coalesce(qm.sent_at, qm.created_at), qm.status::text, qm.error,
         null::uuid, null::text, qm.quote_id, q.reference
    from public.quote_messages qm
    left join public.quotes q on q.id = qm.quote_id
   where qm.direction = 'out';
grant select on public.inbox_sent_v to authenticated;

notify pgrst, 'reload schema';
