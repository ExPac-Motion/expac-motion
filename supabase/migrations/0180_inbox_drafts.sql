-- 0180: Inbox › Drafts. An email being written in the Inbox (new, reply,
-- reply all, forward) saves itself here a moment after each change, and
-- shows in the Drafts folder until it's sent or discarded. Each draft
-- belongs to the login that wrote it.
--
--   Recipients are kept as typed (comma-separated). Files attached to a
--   draft live in the private "inbox" bucket under drafts/<draft id>/;
--   forward_files lists which of the forwarded email's own attachments
--   stay ticked.

create table if not exists public.inbox_drafts (
  id            uuid primary key default gen_random_uuid(),
  to_emails     text not null default '',
  cc_emails     text not null default '',
  bcc_emails    text not null default '',
  subject       text not null default '',
  body_html     text not null default '',
  reply_to_id   uuid references public.inbox_messages (id) on delete set null,
  reply_all     boolean not null default false,
  forward_id    uuid references public.inbox_messages (id) on delete set null,
  include_original boolean not null default true,
  forward_files text[],
  attachments   jsonb not null default '[]'::jsonb,
  created_by    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists inbox_drafts_owner on public.inbox_drafts (created_by, updated_at desc);

alter table public.inbox_drafts enable row level security;
drop policy if exists "own drafts" on public.inbox_drafts;
create policy "own drafts" on public.inbox_drafts for all to authenticated
  using (public.can_use_inbox() and created_by = auth.uid())
  with check (public.can_use_inbox() and created_by = auth.uid());

-- Draft attachments: inbox users may add and remove files under drafts/.
-- (Reading is already allowed for the whole bucket, 0134.)
drop policy if exists "inbox users write drafts" on storage.objects;
create policy "inbox users write drafts" on storage.objects for insert to authenticated
  with check (bucket_id = 'inbox' and name like 'drafts/%' and public.can_use_inbox());
drop policy if exists "inbox users delete drafts" on storage.objects;
create policy "inbox users delete drafts" on storage.objects for delete to authenticated
  using (bucket_id = 'inbox' and name like 'drafts/%' and public.can_use_inbox());

notify pgrst, 'reload schema';
