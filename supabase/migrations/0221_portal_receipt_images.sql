-- ============================================================
-- 0221  Portal: cargo images on warehouse receipts load again
-- ============================================================
-- The receipt photos (wms_receipt_images, 0147) had their own storage
-- policy keyed on my_client_id() only. Storage signs a download link with
-- a POST, where my_client_id() doesn't resolve the customer an admin is
-- previewing (same problem 0171 fixed for shared documents and PODs), so
-- the signed link came back empty and the portal showed a broken image.
--
-- portal_can_open_file() now also allows a receipt image on one of the
-- customer's receipts (signed-in customer OR previewed customer), and the
-- old 0147 policy is folded into it. SELECT only, uploads stay staff-only.
--
-- Run in the Supabase SQL editor after 0220. Self-contained & idempotent.

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
         )
      or exists (
           select 1 from public.wms_receipt_images i
           join public.wms_receipts r on r.id = i.receipt_id
           where i.storage_path = p_name
             and r.client_id = v_client
         );
end;
$$;
grant execute on function public.portal_can_open_file(text) to authenticated;

-- Folded into portal_can_open_file() above.
drop policy if exists "clients view own receipt images" on storage.objects;

