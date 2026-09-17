-- ============================================================
-- 0096  Web forms: "Image upload" field type
-- ============================================================
-- New public storage bucket for images attached to a hosted web form's
-- "Image upload" field (e.g. a photo of the cargo on the Contact Us form).
-- Anonymous visitors need to be able to upload here with no session --
-- there is no other way for a public contact form to accept a file --
-- so this is intentionally open write, scoped to this one bucket only,
-- with a size cap and an image-only allow-list to limit abuse.
--
-- The bucket is public so staff can open the resulting URL (stored as
-- the field's value, same as any other answer, appended into the Lead's
-- notes by submit_web_form()) directly from the Lead record.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'web-form-uploads',
  'web-form-uploads',
  true,
  8388608, -- 8 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "web-form-uploads public write" on storage.objects;
create policy "web-form-uploads public write" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'web-form-uploads');

drop policy if exists "web-form-uploads public read" on storage.objects;
create policy "web-form-uploads public read" on storage.objects
  for select to public
  using (bucket_id = 'web-form-uploads');
