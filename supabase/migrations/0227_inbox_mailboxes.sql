-- ============================================================
-- 0227  Inbox: your own mailbox, all its folders, two-way with Outlook
-- ============================================================
-- Until now the Inbox was a one-way copy of support@'s Inbox, Sent and
-- Junk, shared by every login with Inbox access, and Archive / Delete /
-- Flag / Read lived in Motion only. From here:
--
--   * MAILBOXES. Each login connects its own mailbox (mailboxes, one per
--     login). Its password is kept in Supabase Vault, read only by the
--     server (service role). support@ is created here and keeps using the
--     IMAP_* settings on Cloudflare (secret_id empty), so nothing changes
--     for it until someone connects another mailbox.
--
--   * PRIVATE. The Inbox shows only your own mailbox. Mail that is linked
--     to a shipment stays visible to everyone with Inbox access (it shows
--     on the shipment), like before. Admins see mail of a mailbox nobody
--     owns yet.
--
--   * ALL FOLDERS. /api/inbox-sync reads every folder of the mailbox
--     (your own folders, Archive, Sent, …) into mailbox_folders, and each
--     message carries its folder. A message moved or deleted in Outlook
--     moves or leaves here too (gone_at; the copy that turns up in another
--     folder takes over its links and notes, inbox_reconcile).
--
--   * TWO-WAY. When the mailbox has write_back on, Read / Unread, Flag,
--     Archive, Delete, Spam / Not spam and Move to folder done in Motion
--     are recorded on the message (pending_*) and /api/inbox-sync makes
--     the same change on the mail server, so Outlook shows it too. Mail
--     sent from Motion gets a copy in the server's Sent folder. write_back
--     starts OFF: switch it on in Inbox › Mailbox once the folders look
--     right.
--
-- Safe to run more than once.

-- ---------- 1. Mailboxes ----------
create table if not exists public.mailboxes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid unique references auth.users (id) on delete set null,
  email         text not null unique,
  display_name  text,
  imap_host     text,
  imap_port     integer not null default 993,
  imap_user     text,
  -- Vault secret holding the password; empty = the Cloudflare IMAP_* settings.
  secret_id     uuid,
  enabled       boolean not null default true,
  write_back    boolean not null default false,
  last_sync_at  timestamptz,
  last_error    text,
  pending       integer,
  last_push_at  timestamptz,
  push_error    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.mailbox_folders (
  mailbox_id   uuid not null references public.mailboxes (id) on delete cascade,
  path         text not null,
  name         text not null,
  delim        text,
  -- inbox | sent | archive | trash | junk | drafts, or empty for your own folders
  role         text check (role in ('inbox', 'sent', 'archive', 'trash', 'junk', 'drafts')),
  uidvalidity  bigint,
  uidnext      bigint,
  messages     integer,
  modseq       text,
  -- Outlook's system folders (Outbox, Sync Issues, …) and Drafts: not synced.
  hidden       boolean not null default false,
  backlog      integer not null default 0,
  synced_at    timestamptz,
  primary key (mailbox_id, path)
);

-- support@ (the mailbox the Inbox has always shown), owned by the
-- support@ login when there is one.
insert into public.mailboxes (email, owner_id, display_name)
select 'support@expac.co.za',
       (select u.id from auth.users u where lower(u.email) = 'support@expac.co.za' limit 1),
       'ExPac Support'
where not exists (select 1 from public.mailboxes where email = 'support@expac.co.za');

-- ---------- 2. Messages: which mailbox, which folder, what's waiting ----------
alter table public.inbox_messages
  add column if not exists mailbox_id   uuid references public.mailboxes (id) on delete cascade,
  add column if not exists folder       text,
  -- No longer in its folder on the server (moved or deleted in Outlook).
  add column if not exists gone_at      timestamptz,
  -- The server's own Flagged (Outlook's flag), apart from Motion's flag.
  add column if not exists server_flagged boolean not null default false,
  -- Changes made in Motion, still to be made on the server.
  add column if not exists pending_at   timestamptz,
  add column if not exists pending_from_folder text,
  add column if not exists pending_from_uid bigint,
  add column if not exists pending_from_uidvalidity bigint,
  add column if not exists pending_seen boolean,
  add column if not exists pending_flagged boolean,
  add column if not exists pending_append boolean not null default false;

-- Existing rows belong to support@: its Inbox, Sent ('\sent' until the sync
-- learns the real folder name) and Junk; mail sent from the app has no
-- folder on the server.
update public.inbox_messages m
   set mailbox_id = b.id,
       folder = case
         when m.uid is null then null
         when m.mailbox = 'support' then 'INBOX'
         when m.mailbox = 'support:sent' then '\sent'
         when m.mailbox = 'support:junk' then '\junk'
       end
  from public.mailboxes b
 where b.email = 'support@expac.co.za' and m.mailbox_id is null;

-- 0136 dropped a Junk copy when the same message reached the Inbox. A move
-- out of Junk is now followed like any other move (and the old trigger
-- could reach into another login's mailbox).
drop trigger if exists trg_inbox_drop_junk_copy on public.inbox_messages;

-- One row per message per folder.
alter table public.inbox_messages drop constraint if exists inbox_messages_imap_uid;
alter table public.inbox_messages drop constraint if exists inbox_messages_folder_uid;
alter table public.inbox_messages
  add constraint inbox_messages_folder_uid unique (mailbox_id, folder, uidvalidity, uid);
create index if not exists inbox_messages_mailbox on public.inbox_messages (mailbox_id, sent_at desc);
create index if not exists inbox_messages_pending on public.inbox_messages (mailbox_id) where pending_at is not null;
create index if not exists inbox_messages_gone on public.inbox_messages (mailbox_id) where gone_at is not null;
create index if not exists inbox_messages_raw on public.inbox_messages (raw_path);

-- ---------- 3. Who sees what ----------
-- My mailboxes: the one I own, plus (admins) any nobody owns yet.
create or replace function public.my_mailbox_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(b.id), '{}')
    from public.mailboxes b
   where b.owner_id = auth.uid() or (b.owner_id is null and public.is_admin());
$$;
grant execute on function public.my_mailbox_ids() to authenticated;

alter table public.mailboxes enable row level security;
drop policy if exists "own mailbox" on public.mailboxes;
create policy "own mailbox" on public.mailboxes for select to authenticated
  using (id in (select unnest(public.my_mailbox_ids())) or public.is_admin());
drop policy if exists "own mailbox settings" on public.mailboxes;
create policy "own mailbox settings" on public.mailboxes for update to authenticated
  using (id in (select unnest(public.my_mailbox_ids())))
  with check (id in (select unnest(public.my_mailbox_ids())));
-- The owner may switch these; connecting (address, server, password) goes
-- through /api/mailbox-connect, which tests the login first.
revoke insert, update, delete on public.mailboxes from anon, authenticated;
grant select on public.mailboxes to authenticated;
grant update (display_name, enabled, write_back) on public.mailboxes to authenticated;

alter table public.mailbox_folders enable row level security;
drop policy if exists "own folders" on public.mailbox_folders;
create policy "own folders" on public.mailbox_folders for select to authenticated
  using (mailbox_id in (select unnest(public.my_mailbox_ids())));
revoke insert, update, delete on public.mailbox_folders from anon, authenticated;
grant select on public.mailbox_folders to authenticated;

drop policy if exists "inbox users" on public.inbox_messages;
drop policy if exists "inbox read" on public.inbox_messages;
drop policy if exists "inbox add" on public.inbox_messages;
drop policy if exists "inbox change" on public.inbox_messages;
-- Your own mail, plus any mail on a shipment (it shows on the shipment).
create policy "inbox read" on public.inbox_messages for select to authenticated
  using (
    public.can_use_inbox()
    and (mailbox_id in (select unnest(public.my_mailbox_ids())) or job_id is not null)
  );
create policy "inbox add" on public.inbox_messages for insert to authenticated
  with check (public.can_use_inbox() and mailbox_id in (select unnest(public.my_mailbox_ids())));
create policy "inbox change" on public.inbox_messages for update to authenticated
  using (public.can_use_inbox() and mailbox_id in (select unnest(public.my_mailbox_ids())))
  with check (public.can_use_inbox() and mailbox_id in (select unnest(public.my_mailbox_ids())));

-- A message's raw source: readable by whoever may see the message.
drop policy if exists "inbox users read raw" on storage.objects;
create policy "inbox users read raw" on storage.objects for select to authenticated
  using (
    bucket_id = 'inbox' and public.can_use_inbox()
    and (
      name like 'drafts/%'
      or exists (select 1 from public.inbox_messages m where m.raw_path = storage.objects.name)
    )
  );

-- ---------- 4. Folders and their roles ----------
-- '\archive' style names stand for "the mailbox's Archive folder" until the
-- server's real folder is known.
create or replace function public.inbox_folder_role(p_mailbox uuid, p_folder text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_folder is null then null
    when left(p_folder, 1) = '\' then substr(p_folder, 2)
    when upper(p_folder) = 'INBOX' then 'inbox'
    else (select f.role from public.mailbox_folders f where f.mailbox_id = p_mailbox and f.path = p_folder)
  end;
$$;
grant execute on function public.inbox_folder_role(uuid, text) to authenticated;

create or replace function public.inbox_role_path(p_mailbox uuid, p_role text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_role = 'inbox' then 'INBOX'
    else coalesce(
      (select f.path from public.mailbox_folders f
        where f.mailbox_id = p_mailbox and f.role = p_role order by f.path limit 1),
      '\' || p_role)
  end;
$$;

-- ---------- 5. Changes made in Motion, and where a message now is ----------
create or replace function public.inbox_track_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- A person in the app (the server sync runs as service role: no auth.uid()).
  by_user boolean := auth.uid() is not null;
  two_way boolean := false;
  on_server boolean := coalesce(old.uid, old.pending_from_uid) is not null;
  target text;
  r text;
begin
  if by_user and new.mailbox_id is not null then
    select b.write_back into two_way from public.mailboxes b where b.id = new.mailbox_id;
  end if;

  if by_user and coalesce(two_way, false) and on_server then
    -- Where should it be on the server?
    if new.folder is distinct from old.folder then
      target := new.folder;
    elsif new.deleted_at is not null and old.deleted_at is null then
      target := public.inbox_role_path(new.mailbox_id, 'trash');
    elsif new.deleted_at is null and old.deleted_at is not null then
      target := public.inbox_role_path(new.mailbox_id,
        case when new.spam then 'junk' when new.archived_at is not null then 'archive' else 'inbox' end);
    elsif new.spam and not old.spam then
      target := public.inbox_role_path(new.mailbox_id, 'junk');
    elsif not new.spam and old.spam then
      target := 'INBOX';
    elsif new.archived_at is not null and old.archived_at is null then
      target := public.inbox_role_path(new.mailbox_id, 'archive');
    elsif new.archived_at is null and old.archived_at is not null then
      target := 'INBOX';
    end if;

    if target is not null and target is distinct from old.folder then
      new.folder := target;
      -- Remember where it really is on the server until it's moved there.
      if new.pending_from_folder is null then
        new.pending_from_folder := old.folder;
        new.pending_from_uid := old.uid;
        new.pending_from_uidvalidity := old.uidvalidity;
      end if;
      if new.folder = new.pending_from_folder then
        -- Moved back before the server saw it: nothing to move.
        new.uid := new.pending_from_uid;
        new.uidvalidity := new.pending_from_uidvalidity;
        new.pending_from_folder := null;
        new.pending_from_uid := null;
        new.pending_from_uidvalidity := null;
      else
        new.uid := null;
      end if;
      new.pending_at := now();
    end if;

    -- Read / unread and the flag.
    if (new.read_at is not null and old.read_at is null)
       or (old.marked_unread and not new.marked_unread and new.read_at is not null) then
      new.pending_seen := true;
      new.pending_at := now();
    elsif new.marked_unread and not old.marked_unread then
      new.pending_seen := false;
      new.pending_at := now();
    end if;
    if new.flagged is distinct from old.flagged then
      new.pending_flagged := new.flagged;
      new.pending_at := now();
    end if;
  elsif by_user and new.folder is distinct from old.folder then
    -- Two-way is off: a message can't be moved to another server folder.
    new.folder := old.folder;
  end if;

  -- Archive / Trash / Spam follow the folder the message is in.
  if new.folder is distinct from old.folder and new.folder is not null then
    r := public.inbox_folder_role(new.mailbox_id, new.folder);
    new.deleted_at := case when r = 'trash' then coalesce(new.deleted_at, now()) end;
    new.archived_at := case when r = 'archive' then coalesce(new.archived_at, now()) end;
    new.spam := coalesce(r = 'junk', false);
    if r is distinct from 'inbox' then
      new.snoozed_until := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_inbox_track_changes on public.inbox_messages;
create trigger trg_inbox_track_changes
  before update on public.inbox_messages
  for each row execute function public.inbox_track_changes();

-- ---------- 6. Server side (service role only) ----------

-- One folder seen on the server: which recent uids still have to be
-- fetched, which stored messages left the folder, and the server's flags.
--   p_all    every uid in the folder now
--   p_recent the uids inside the history window (fetched if missing)
--   p_flags  {uid: [seen, answered, flagged]} for recent mail
create or replace function public.inbox_folder_seen(
  p_mailbox uuid, p_folder text, p_uidvalidity bigint,
  p_all bigint[], p_recent bigint[], p_flags jsonb
) returns bigint[] language plpgsql security definer set search_path = public as $$
declare
  missing bigint[];
begin
  -- Left the folder (or the folder was rebuilt: new uidvalidity).
  update public.inbox_messages m
     set gone_at = now()
   where m.mailbox_id = p_mailbox and m.folder = p_folder
     and m.uid is not null and m.gone_at is null and m.pending_at is null
     and (m.uidvalidity is distinct from p_uidvalidity or not (m.uid = any (p_all)));
  -- Back again (should not happen, but never lose a row over it).
  update public.inbox_messages m
     set gone_at = null
   where m.mailbox_id = p_mailbox and m.folder = p_folder and m.gone_at is not null
     and m.uidvalidity = p_uidvalidity and m.uid = any (p_all);

  -- Flags changed in Outlook: read / unread, answered, flagged.
  update public.inbox_messages m
     set seen = (f.value ->> 0)::boolean,
         answered = (f.value ->> 1)::boolean,
         server_flagged = (f.value ->> 2)::boolean,
         -- Marked unread in Outlook: unread here too.
         read_at = case when m.seen and not (f.value ->> 0)::boolean then null else m.read_at end,
         marked_unread = case when m.seen and not (f.value ->> 0)::boolean then false else m.marked_unread end,
         -- Flag set or cleared in Outlook: same here.
         flagged = case when m.server_flagged is distinct from (f.value ->> 2)::boolean
                        then (f.value ->> 2)::boolean else m.flagged end
    from jsonb_each(coalesce(p_flags, '{}'::jsonb)) f
   where m.mailbox_id = p_mailbox and m.folder = p_folder and m.uidvalidity = p_uidvalidity
     and m.uid = f.key::bigint and m.pending_at is null
     and (m.seen is distinct from (f.value ->> 0)::boolean
          or m.answered is distinct from (f.value ->> 1)::boolean
          or m.server_flagged is distinct from (f.value ->> 2)::boolean);

  -- Recent uids not stored yet, newest first. A message waiting to be moved
  -- out of this folder still counts as stored.
  select coalesce(array_agg(u order by u desc), '{}') into missing
    from unnest(coalesce(p_recent, '{}')) u
   where not exists (
           select 1 from public.inbox_messages m
            where m.mailbox_id = p_mailbox and m.folder = p_folder
              and m.uidvalidity = p_uidvalidity and m.uid = u)
     and not exists (
           select 1 from public.inbox_messages m
            where m.mailbox_id = p_mailbox and m.pending_from_folder = p_folder
              and m.pending_from_uidvalidity = p_uidvalidity and m.pending_from_uid = u);
  return missing;
end;
$$;

-- New uids in a folder that are messages we already hold elsewhere (moved
-- in Outlook, or our own copy in Sent): the row moves with them instead of
-- being fetched again. p_items: [{uid, message_id, motion_id}]. Returns the
-- uids that were matched.
create or replace function public.inbox_relocate(
  p_mailbox uuid, p_folder text, p_uidvalidity bigint, p_items jsonb
) returns bigint[] language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  hit uuid;
  done bigint[] := '{}';
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    hit := null;
    -- Our own copy (sent from Motion, appended to Sent).
    if coalesce(it ->> 'motion_id', '') ~ '^[0-9a-f-]{36}$' then
      select m.id into hit from public.inbox_messages m
       where m.id = (it ->> 'motion_id')::uuid and m.mailbox_id = p_mailbox
         and (m.uid is null or m.gone_at is not null);
    end if;
    -- The same message that left another folder.
    if hit is null and coalesce(it ->> 'message_id', '') <> '' then
      select m.id into hit from public.inbox_messages m
       where m.mailbox_id = p_mailbox and m.message_id = it ->> 'message_id'
         and m.gone_at is not null and m.pending_at is null
       order by m.gone_at desc limit 1;
    end if;
    if hit is not null then
      update public.inbox_messages m
         set folder = p_folder, uidvalidity = p_uidvalidity, uid = (it ->> 'uid')::bigint,
             gone_at = null, pending_append = false
       where m.id = hit;
      done := done || (it ->> 'uid')::bigint;
    end if;
  end loop;
  return done;
end;
$$;

-- A message that left one folder and was fetched again in another (the
-- other folder synced first): the new row takes over the old one's links
-- and notes, then the old row goes.
create or replace function public.inbox_reconcile(p_mailbox uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  create temporary table if not exists _inbox_pairs (gid uuid, lid uuid) on commit drop;
  delete from _inbox_pairs;
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

-- Changes made on the server by /api/inbox-sync. p_results:
-- [{id, token, folder, uid, uidvalidity}] where folder / uid / uidvalidity
-- say where the message now is (uid empty = not known: it's found again by
-- the next sync), token is the pending_at the change was read with.
create or replace function public.inbox_push_done(p_results jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  m public.inbox_messages%rowtype;
  at_folder text;
  at_uid bigint;
  at_uv bigint;
  n integer := 0;
begin
  for it in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    select * into m from public.inbox_messages where id = (it ->> 'id')::uuid for update;
    if not found then continue; end if;
    at_folder := it ->> 'folder';
    at_uid := nullif(it ->> 'uid', '')::bigint;
    at_uv := nullif(it ->> 'uidvalidity', '')::bigint;

    if m.pending_at = (it ->> 'token')::timestamptz then
      -- Nothing changed in the meantime: done.
      update public.inbox_messages
         set folder = coalesce(at_folder, folder),
             uid = at_uid,
             uidvalidity = coalesce(at_uv, uidvalidity),
             gone_at = case when at_uid is null and at_folder is not null then now() else gone_at end,
             pending_at = null, pending_from_folder = null, pending_from_uid = null,
             pending_from_uidvalidity = null, pending_seen = null, pending_flagged = null,
             pending_append = false
       where id = m.id;
    elsif at_uid is not null and m.folder = at_folder then
      -- Moved again, then back to where the server now has it.
      update public.inbox_messages
         set uid = at_uid, uidvalidity = at_uv,
             pending_from_folder = null, pending_from_uid = null, pending_from_uidvalidity = null,
             pending_append = false
       where id = m.id;
    elsif at_uid is not null then
      -- Changed again meanwhile: the next push starts from where it is now.
      update public.inbox_messages
         set pending_from_folder = at_folder, pending_from_uid = at_uid, pending_from_uidvalidity = at_uv,
             pending_append = false
       where id = m.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- The mailbox's folders as the server lists them now. p_folders:
-- [{path, name, delim, role, hidden, uidvalidity?, uidnext?, messages?,
-- modseq?, backlog?, synced_at?}]; with p_complete, folders no longer on the
-- server go (their mail is marked gone: it was moved or deleted). Mail held
-- under a '\sent' style name moves to the real folder once it's known.
create or replace function public.inbox_folders_save(p_mailbox uuid, p_folders jsonb, p_complete boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  paths text[];
begin
  insert into public.mailbox_folders as t
         (mailbox_id, path, name, delim, role, hidden, uidvalidity, uidnext, messages, modseq, backlog, synced_at)
  select p_mailbox, f ->> 'path', coalesce(f ->> 'name', f ->> 'path'), f ->> 'delim', nullif(f ->> 'role', ''),
         coalesce((f ->> 'hidden')::boolean, false),
         (f ->> 'uidvalidity')::bigint, (f ->> 'uidnext')::bigint, (f ->> 'messages')::integer,
         f ->> 'modseq', coalesce((f ->> 'backlog')::integer, 0), (f ->> 'synced_at')::timestamptz
    from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) f
   where coalesce(f ->> 'path', '') <> ''
  on conflict (mailbox_id, path) do update
     set name = excluded.name, delim = excluded.delim, role = excluded.role, hidden = excluded.hidden,
         uidvalidity = coalesce(excluded.uidvalidity, t.uidvalidity),
         uidnext = coalesce(excluded.uidnext, t.uidnext),
         messages = coalesce(excluded.messages, t.messages),
         modseq = coalesce(excluded.modseq, t.modseq),
         backlog = case when excluded.synced_at is not null then excluded.backlog else t.backlog end,
         synced_at = coalesce(excluded.synced_at, t.synced_at);

  if p_complete then
    select coalesce(array_agg(f ->> 'path'), '{}') into paths
      from jsonb_array_elements(coalesce(p_folders, '[]'::jsonb)) f;
    update public.inbox_messages m
       set gone_at = now()
     where m.mailbox_id = p_mailbox and m.folder is not null and left(m.folder, 1) <> '\'
       and upper(m.folder) <> 'INBOX' and not (m.folder = any (paths))
       and m.gone_at is null and m.pending_at is null;
    delete from public.mailbox_folders t
     where t.mailbox_id = p_mailbox and not (t.path = any (paths));
  end if;

  update public.inbox_messages m
     set folder = f.path
    from public.mailbox_folders f
   where m.mailbox_id = p_mailbox and f.mailbox_id = p_mailbox and f.role is not null
     and m.folder = '\' || f.role;
end;
$$;

-- Connecting a mailbox (after /api/mailbox-connect has tested the login).
create or replace function public.mailbox_save(
  p_owner uuid, p_email text, p_host text, p_port integer, p_user text, p_password text
) returns uuid language plpgsql security definer set search_path = public, vault as $$
declare
  b public.mailboxes%rowtype;
  sid uuid;
begin
  select * into b from public.mailboxes where owner_id = p_owner;
  if not found then
    select * into b from public.mailboxes where lower(email) = lower(p_email) and owner_id is null;
  end if;
  if b.id is not null and b.secret_id is not null then
    perform vault.update_secret(b.secret_id, p_password);
    sid := b.secret_id;
  else
    sid := vault.create_secret(p_password, 'mailbox:' || lower(p_email) || ':' || gen_random_uuid(),
                               'IMAP password for ' || lower(p_email));
  end if;
  if b.id is null then
    insert into public.mailboxes (owner_id, email, imap_host, imap_port, imap_user, secret_id)
    values (p_owner, lower(p_email), p_host, coalesce(p_port, 993), p_user, sid)
    returning * into b;
  else
    update public.mailboxes
       set owner_id = p_owner, email = lower(p_email), imap_host = p_host,
           imap_port = coalesce(p_port, 993), imap_user = p_user, secret_id = sid,
           enabled = true, last_error = null
     where id = b.id
    returning * into b;
  end if;
  return b.id;
end;
$$;

create or replace function public.mailbox_password(p_mailbox uuid)
returns text language sql stable security definer set search_path = public, vault as $$
  select s.decrypted_secret
    from public.mailboxes b join vault.decrypted_secrets s on s.id = b.secret_id
   where b.id = p_mailbox;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'inbox_folder_seen(uuid, text, bigint, bigint[], bigint[], jsonb)',
    'inbox_relocate(uuid, text, bigint, jsonb)',
    'inbox_reconcile(uuid)',
    'inbox_push_done(jsonb)',
    'inbox_folders_save(uuid, jsonb, boolean)',
    'mailbox_save(uuid, text, text, integer, text, text)',
    'mailbox_password(uuid)',
    'inbox_role_path(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- 7. Views ----------
-- The view lists m.* as it was when created: recreate it for the new columns.
drop view if exists public.inbox_mine_v;
drop view if exists public.inbox_messages_v;
create view public.inbox_messages_v with (security_invoker = true) as
  select m.*, s.category, s.record_kind, s.record_id, s.record_name,
         j.reference as job_reference,
         public.inbox_folder_role(m.mailbox_id, m.folder) as folder_role
    from public.inbox_messages m
    left join lateral public.inbox_sender_match(
      case when m.direction = 'out' then m.to_emails[1] else m.from_email end
    ) s on true
    left join public.jobs j on j.id = m.job_id;
grant select on public.inbox_messages_v to authenticated;

-- The Inbox itself: my own mailbox only, and only what's still in a folder.
create view public.inbox_mine_v with (security_invoker = true) as
  select * from public.inbox_messages_v
   where mailbox_id in (select unnest(public.my_mailbox_ids())) and gone_at is null;
grant select on public.inbox_mine_v to authenticated;

drop view if exists public.inbox_mine;
create view public.inbox_mine with (security_invoker = true) as
  select * from public.inbox_messages
   where mailbox_id in (select unnest(public.my_mailbox_ids())) and gone_at is null;
grant select on public.inbox_mine to authenticated;

-- Sent: from the server's Sent folder ('outlook') or sent from Motion.
drop view if exists public.inbox_sent_v;
create view public.inbox_sent_v with (security_invoker = true) as
  select m.id,
         case when m.provider_id is null and m.uid is not null then 'outlook' else 'inbox' end::text as source,
         m.to_emails, m.cc_emails, m.subject,
         coalesce(m.snippet, '') as preview, m.body_html as body,
         m.sent_at, coalesce(m.delivery_status, case when m.provider_id is null then 'saved' else 'sent' end) as status,
         null::text as error, m.job_id, j.reference as job_reference, null::uuid as quote_id, null::text as quote_reference
    from public.inbox_messages m
    left join public.jobs j on j.id = m.job_id
   where m.direction = 'out' and m.gone_at is null
     and m.mailbox_id in (select unnest(public.my_mailbox_ids()))
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

-- ---------- 8. Live updates ----------
do $$
declare
  t text;
begin
  foreach t in array array['mailboxes', 'mailbox_folders'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Check: the mailboxes, and where support@'s mail sits.
-- select email, owner_id is not null as owned, write_back, last_sync_at, last_error from public.mailboxes;
-- select folder, count(*) from public.inbox_messages group by 1 order by 2 desc;
