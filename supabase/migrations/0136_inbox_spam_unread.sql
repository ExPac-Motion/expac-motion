-- 0136: Inbox — Spam folder, a "Mark unread" that sticks, and Sent items.
--   * spam: the sync also reads the mailbox's Junk / Spam folder (where
--     Outlook / the mail server files suspected spam) into the app's Spam
--     folder. "Not spam" / "Spam" move a message in the app. If a message is
--     moved out of Junk on the server (e.g. in Outlook), its Junk copy here is
--     dropped when the Inbox copy arrives.
--   * marked_unread: "Mark unread" in the app wins over the server's Seen flag
--     (mail already read in Outlook used to stay read) until it's opened again.

alter table public.inbox_messages
  add column if not exists spam boolean not null default false,
  add column if not exists marked_unread boolean not null default false,
  -- Sent from the app: Resend's id, and its delivery events via /api/mail-webhook.
  add column if not exists provider_id text,
  add column if not exists delivery_status text;
create index if not exists inbox_messages_provider on public.inbox_messages (provider_id);

create index if not exists inbox_messages_message_id on public.inbox_messages (message_id);

create or replace function public.inbox_drop_junk_copy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.spam and new.direction = 'in' and new.message_id is not null then
    delete from public.inbox_messages
     where spam and direction = 'in' and message_id = new.message_id and id <> new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_inbox_drop_junk_copy on public.inbox_messages;
create trigger trg_inbox_drop_junk_copy
  after insert on public.inbox_messages
  for each row execute function public.inbox_drop_junk_copy();

-- The view lists m.* as it was when created — recreate it for the new columns.
drop view if exists public.inbox_messages_v;
create view public.inbox_messages_v with (security_invoker = true) as
  select m.*, s.category, s.record_kind, s.record_id, s.record_name,
         j.reference as job_reference
    from public.inbox_messages m
    left join lateral public.inbox_sender_match(
      case when m.direction = 'out' then m.to_emails[1] else m.from_email end
    ) s on true
    left join public.jobs j on j.id = m.job_id;
grant select on public.inbox_messages_v to authenticated;

-- Sent items: everything sent from the app — Inbox replies / forwards / new
-- emails, Shipment Comms and quotation emails — with its delivery status.
drop view if exists public.inbox_sent_v;
create view public.inbox_sent_v with (security_invoker = true) as
  select m.id, 'inbox'::text as source, m.to_emails, m.cc_emails, m.subject,
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
