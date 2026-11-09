-- ============================================================
-- 0228  Inbox › Your folders: hide or show a folder in Motion
-- ============================================================
-- A folder you don't want to see in Motion (an old project folder, say)
-- can be hidden from Your folders and from Move to… It stays on the mail
-- server and keeps syncing, so mail moved into it in Outlook is still
-- followed; showing it again brings it straight back. Only the mailbox's
-- owner can hide or show its folders. (mailbox_folders.hidden stays the
-- sync's own flag for Outlook's system folders and Drafts.)
--
-- Safe to run more than once.

alter table public.mailbox_folders
  add column if not exists hidden_by_user boolean not null default false;

drop policy if exists "own folders settings" on public.mailbox_folders;
create policy "own folders settings" on public.mailbox_folders for update to authenticated
  using (mailbox_id in (select unnest(public.my_mailbox_ids())))
  with check (mailbox_id in (select unnest(public.my_mailbox_ids())));
grant update (hidden_by_user) on public.mailbox_folders to authenticated;

notify pgrst, 'reload schema';
