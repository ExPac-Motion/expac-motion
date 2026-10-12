-- ============================================================
-- 0160  Customer Portal: shared shipment documents open again
-- ============================================================
-- The storage rule from 0026 ("clients view shared documents") checks
-- shipment_documents + jobs, but runs that check as the customer, who
-- can't read those tables directly (staff-only RLS), so every download
-- link was refused. The check now goes through a security-definer
-- function that answers only "is this file shared with my customer?".
--
-- Run in the Supabase SQL editor after 0159. Self-contained & idempotent.

create or replace function public.client_can_read_document(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_client_id() is not null and exists (
    select 1 from public.shipment_documents sd
    join public.jobs j on j.id = sd.job_id
    where sd.storage_path = p_path
      and sd.visible_to_client = true
      and j.client_id = public.my_client_id()
  );
$$;
grant execute on function public.client_can_read_document(text) to authenticated;

drop policy if exists "clients view shared documents" on storage.objects;
create policy "clients view shared documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'shipment-documents' and public.client_can_read_document(name));

notify pgrst, 'reload schema';
