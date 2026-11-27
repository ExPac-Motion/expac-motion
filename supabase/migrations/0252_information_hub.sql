-- =====================================================================
-- 0252 Information Hub (customer + partner portals)
-- =====================================================================
-- Guides, manuals and marketing content ExPac publishes to its portals.
-- Staff manage them in CRM > Media > Information Hub: upload a PDF or an
-- image (and a cover), pick who sees it (partners, customers or both),
-- publish / unpublish and order them.
--
--   hub_items       one card on the Hub
--   bucket "hub"    public files (anyone with the link can open them,
--                   same as the existing /hub PDFs)
-- Customers read published customers/both items; partner logins read
-- published partners/both items; staff manage everything.
-- Seeds the Hub's current PDFs and the Partner Portal Manual.
--
-- Run in the Supabase SQL editor after 0251. Self-contained & idempotent.
-- =====================================================================

create table if not exists public.hub_items (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 1 and 160),
  description  text,
  tag          text not null default 'Guide',
  kind         text not null default 'file' check (kind in ('file', 'image', 'link')),
  file_url     text not null,
  cover_url    text,
  meta         text,
  audience     text not null default 'both' check (audience in ('partners', 'customers', 'both')),
  published    boolean not null default true,
  sort         integer not null default 100,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
alter table public.hub_items enable row level security;

drop policy if exists "staff manage hub" on public.hub_items;
create policy "staff manage hub" on public.hub_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "customers read hub" on public.hub_items;
create policy "customers read hub" on public.hub_items
  for select to authenticated
  using (published and audience in ('customers', 'both') and public.my_client_id() is not null);

drop policy if exists "partners read hub" on public.hub_items;
create policy "partners read hub" on public.hub_items
  for select to authenticated
  using (published and audience in ('partners', 'both') and public.my_partner_kind() is not null);

-- Public bucket for Hub files; only staff upload / change / remove.
insert into storage.buckets (id, name, public)
values ('hub', 'hub', true)
on conflict (id) do update set public = true;

drop policy if exists "staff upload hub files" on storage.objects;
create policy "staff upload hub files" on storage.objects
  for insert to authenticated with check (bucket_id = 'hub' and public.is_staff());
drop policy if exists "staff change hub files" on storage.objects;
create policy "staff change hub files" on storage.objects
  for update to authenticated using (bucket_id = 'hub' and public.is_staff());
drop policy if exists "staff remove hub files" on storage.objects;
create policy "staff remove hub files" on storage.objects
  for delete to authenticated using (bucket_id = 'hub' and public.is_staff());

-- Seed what the Hub shows today (files shipped with the site under /hub).
insert into public.hub_items (title, description, tag, kind, file_url, cover_url, meta, audience, sort, created_by)
select * from (values
  ('Quote Request & Portal Manual',
   'Step by step: request a quotation, ask for a revision, accept it, add your shippers and follow every shipment, live.',
   'How-to guide', 'file', '/hub/expac-motion-quote-request-manual.pdf', '/hub/cover-quote-manual.jpg',
   'PDF · 15 pages · 4 MB', 'customers', 10, null::uuid),
  ('Introducing ExPac Motion',
   'A tour of the portal: quotes, tracking, documents, warehouse, invoices, reports and a direct line to our team.',
   'Presentation', 'file', '/hub/expac-motion-presentation.pdf', '/hub/cover-presentation.jpg',
   'PDF · 17 pages · 8.5 MB', 'both', 20, null::uuid),
  ('Partner Portal Manual',
   'How to use the ExPac Partner Portal: accept shipments, update milestones and booking details, upload documents, message ExPac, answer rate requests and keep your rates current.',
   'How-to guide', 'file', '/hub/expac-motion-partner-portal-manual.pdf', '/hub/cover-partner-manual.png',
   'PDF · 7 MB', 'partners', 10, null::uuid)
) v(title, description, tag, kind, file_url, cover_url, meta, audience, sort, created_by)
where not exists (select 1 from public.hub_items h where h.file_url = v.file_url);

notify pgrst, 'reload schema';
