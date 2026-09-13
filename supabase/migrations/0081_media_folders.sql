-- ============================================================
-- 0081  Media gallery — named folders
-- ============================================================
-- Folders in the Media gallery were purely derived from the `folder` label
-- on each media_assets row -- "+ New folder" only ever set local React
-- state, so a freshly created (still-empty) folder vanished on refresh or
-- for any other team member since nothing was ever written to the
-- database. This table lets an empty folder persist and be shared; once a
-- folder holds an asset it already shows up from that asset's `folder`
-- label too (see media_assets_folder_idx), so this table only needs to
-- cover the empty case.
--
-- Run in the Supabase SQL editor after 0080. Self-contained & idempotent.

create table if not exists public.media_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.media_folders enable row level security;
drop policy if exists "team full access" on public.media_folders;
create policy "team full access" on public.media_folders
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());
