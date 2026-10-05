-- 0144: the Customer Portal's "What's new" shows the images in Sales CRM ›
-- Media › Announcements (newest first; the image name is the headline).
-- The images sit in the public mail-assets bucket, so only the list needs a
-- customer-readable view.

create or replace view public.client_announcements
with (security_barrier = true) as
select a.id, a.name, a.url, a.created_at
from public.media_assets a
where lower(trim(a.folder)) = 'announcements'
  and public.my_client_id() is not null;
grant select on public.client_announcements to authenticated;

-- Make sure the folder exists in Media (an empty folder survives a reload).
insert into public.media_folders (name)
select 'Announcements'
where not exists (select 1 from public.media_folders where lower(name) = 'announcements');
