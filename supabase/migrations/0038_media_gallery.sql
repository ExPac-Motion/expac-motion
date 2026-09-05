-- ============================================================
-- 0038  Sales CRM: Media gallery
-- ============================================================
-- A reusable library of images for campaign / template email bodies, so a
-- picture uploaded once (e.g. a banner or signature graphic) can be picked
-- again from the rich-text editor's image button instead of re-uploaded.
--
-- Files reuse the existing PUBLIC `mail-assets` storage bucket (created in
-- 0033) -- external recipients' inboxes fetch inline images by URL with no
-- Supabase auth of their own. The app stores them under a `media/` prefix
-- and serves them through `cdn.expac.co.za` when that custom domain +
-- Pages proxy are configured (VITE_MAIL_CDN_BASE); nothing here depends on
-- that being set up yet.
--
-- Run in the Supabase SQL editor after 0037. Self-contained & idempotent.

create table if not exists public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  folder       text not null default 'General',
  name         text not null,
  url          text not null,
  storage_path text not null,
  size_bytes   int,
  mime         text,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists media_assets_folder_idx
  on public.media_assets (folder, created_at desc);

alter table public.media_assets enable row level security;
drop policy if exists "team full access" on public.media_assets;
create policy "team full access" on public.media_assets
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
