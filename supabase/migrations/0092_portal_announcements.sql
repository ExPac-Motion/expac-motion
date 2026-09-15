-- ============================================================
-- 0092  Portal announcements ("What's New")
-- ============================================================
-- Staff post an image + title/body announcement; every portal client sees
-- it on a new "What's New" page. Broadcast to all clients, not scoped to
-- one client_id — these are company-wide updates (new service, holiday
-- hours, system downtime, etc.), not customer-specific data, so any
-- signed-in portal client may read published ones.
--
-- Run in the Supabase SQL editor after 0091. Self-contained & idempotent.

create table if not exists public.portal_announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  image_url  text,
  published  boolean not null default true,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.portal_announcements enable row level security;

drop policy if exists "staff manage announcements" on public.portal_announcements;
create policy "staff manage announcements" on public.portal_announcements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Portal clients (and only clients — not a merely-authenticated non-staff
-- edge case) read published announcements. is_staff() already covers
-- staff via the policy above, so this only needs to grant clients access.
drop policy if exists "clients read published announcements" on public.portal_announcements;
create policy "clients read published announcements" on public.portal_announcements
  for select to authenticated
  using (published = true and public.my_client_id() is not null);
