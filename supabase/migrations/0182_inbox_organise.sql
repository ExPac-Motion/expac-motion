-- 0182: Inbox › organise. Archive (out of the folders, still found by
-- search, Archive folder), Delete (to Trash, restorable), Flag, and Snooze
-- (hidden until a date, then back as unread). These live in Motion only;
-- the copy on the mail server isn't moved or deleted.

alter table public.inbox_messages
  add column if not exists archived_at   timestamptz,
  add column if not exists deleted_at    timestamptz,
  add column if not exists flagged       boolean not null default false,
  add column if not exists snoozed_until timestamptz;

create index if not exists inbox_messages_snoozed on public.inbox_messages (snoozed_until)
  where snoozed_until is not null;

-- The view lists m.* as it was when created; recreate it for the new columns.
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

notify pgrst, 'reload schema';
