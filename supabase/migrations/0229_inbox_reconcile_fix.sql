-- inbox_reconcile emptied its scratch table with a bare "delete from
-- _inbox_pairs;". Supabase runs API calls with pg-safeupdate, which refuses
-- a DELETE without a WHERE clause, so every sync that reached the reconcile
-- step failed (Last sync failed: ... DELETE requires a WHERE clause).
-- Emptied with TRUNCATE instead; nothing else changes.

create or replace function public.inbox_reconcile(p_mailbox uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  create temporary table if not exists _inbox_pairs (gid uuid, lid uuid) on commit drop;
  truncate _inbox_pairs;
  insert into _inbox_pairs
  select g.id, l.id
    from public.inbox_messages g
    join lateral (
      select l.id from public.inbox_messages l
       where l.mailbox_id = g.mailbox_id and l.message_id = g.message_id
         and l.direction = g.direction and l.gone_at is null and l.id <> g.id
       order by l.created_at desc limit 1
    ) l on true
   where g.mailbox_id = p_mailbox and g.gone_at is not null
     and g.message_id is not null and g.pending_at is null;

  update public.inbox_messages l
     set job_id = case when g.job_linked_by = 'manual' and l.job_linked_by is distinct from 'manual'
                       then g.job_id else coalesce(l.job_id, g.job_id) end,
         job_linked_by = case when g.job_linked_by = 'manual' and l.job_linked_by is distinct from 'manual'
                              then g.job_linked_by
                              when l.job_id is null then g.job_linked_by else l.job_linked_by end,
         read_at = coalesce(l.read_at, g.read_at),
         replied_at = coalesce(l.replied_at, g.replied_at),
         done_at = coalesce(l.done_at, g.done_at),
         snoozed_until = coalesce(l.snoozed_until, g.snoozed_until),
         marked_unread = l.marked_unread or g.marked_unread,
         snippet = coalesce(l.snippet, g.snippet),
         body_text = coalesce(l.body_text, g.body_text),
         provider_id = coalesce(l.provider_id, g.provider_id),
         delivery_status = coalesce(l.delivery_status, g.delivery_status),
         sent_by = coalesce(l.sent_by, g.sent_by)
    from _inbox_pairs p
    join public.inbox_messages g on g.id = p.gid
   where l.id = p.lid;

  update public.inbox_drafts d set reply_to_id = p.lid from _inbox_pairs p where d.reply_to_id = p.gid;
  update public.inbox_drafts d set forward_id = p.lid from _inbox_pairs p where d.forward_id = p.gid;
  delete from public.inbox_messages m using _inbox_pairs p where m.id = p.gid;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.inbox_reconcile(uuid) from public, anon, authenticated;
grant execute on function public.inbox_reconcile(uuid) to service_role;
