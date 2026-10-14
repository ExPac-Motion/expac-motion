-- ============================================================
-- 0171  Portal preview: open the previewed customer's shared files
-- ============================================================
-- Fix for 0167 / 0169. While an admin previews a customer, opening a
-- shared document (portal shipment › Documents / Shipment Documents) or a
-- release POD (portal › Warehouse) failed with "Object not found":
-- storage signs a download link with a POST, my_client_id() only resolves
-- the previewed customer on a GET (is_read_request), and is_staff() is off
-- during a preview, so no storage policy matched.
--
-- portal_can_open_file() decides, for the signed-in customer OR the
-- customer an admin is previewing, whether a shipment-documents object may
-- be read: a shared shipment document on one of their jobs, or the POD of
-- a release they can see. It is security definer so the lookups don't
-- depend on table RLS. Both storage policies are SELECT only, so the
-- preview stays read-only (uploads / deletes keep their 0161 policies).
--
-- Run in the Supabase SQL editor after 0170. Self-contained & idempotent.

create or replace function public.portal_can_open_file(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_client uuid := coalesce(public.my_client_id(), public.portal_preview_client());
begin
  if v_client is null then
    return false;
  end if;
  return exists (
           select 1 from public.shipment_documents sd
           join public.jobs j on j.id = sd.job_id
           where sd.storage_path = p_name
             and sd.visible_to_client = true
             and j.client_id = v_client
         )
      or exists (
           select 1 from public.wms_releases rl
           where rl.pod_path = p_name
             and (
               rl.client_id = v_client
               or exists (
                 select 1 from public.wms_release_lines l
                 join public.wms_receipts r on r.id = l.receipt_id
                 where l.release_id = rl.id and r.client_id = v_client
               )
             )
         );
end;
$$;
grant execute on function public.portal_can_open_file(text) to authenticated;

drop policy if exists "clients view shared documents" on storage.objects;
create policy "clients view shared documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'shipment-documents' and public.portal_can_open_file(name));

-- Folded into portal_can_open_file() above.
drop policy if exists "clients view own release pods" on storage.objects;
