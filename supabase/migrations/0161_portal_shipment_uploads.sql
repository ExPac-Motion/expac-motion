-- ============================================================
-- 0161  Portal shipment page: customers upload their shipment documents
-- ============================================================
-- The portal's "Shipment Documents" box has three slots: Commercial
-- Invoice, Packing List and the house bill (HAWB for air / courier, HBL
-- for sea / road). The customer uploads into them:
--   * the file goes to shipment-documents/portal/<job id>/... (storage rule
--     below: only for a shipment of the customer's own);
--   * portal_add_shipment_document records it (from_client, shared with
--     the customer) and opens a Control Tower task for ExPac to check it;
--   * portal_delete_shipment_document removes one of the customer's own
--     uploads (ExPac's files can't be removed from the portal).
-- Motion shows the files on the shipment as usual, tagged as from the
-- customer.
--
-- Run in the Supabase SQL editor after 0160. Self-contained & idempotent.

alter table public.shipment_documents
  add column if not exists from_client boolean not null default false;

-- Is this a shipment of the signed-in customer? (text in, so a bad folder
-- name in a storage path is just "no", never an error)
create or replace function public.client_owns_job(p_job text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_client_id() is null or p_job !~* '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (select 1 from public.jobs where id = p_job::uuid and client_id = public.my_client_id());
end;
$$;
grant execute on function public.client_owns_job(text) to authenticated;

drop policy if exists "clients upload shipment documents" on storage.objects;
create policy "clients upload shipment documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and (storage.foldername(name))[1] = 'portal'
    and public.client_owns_job((storage.foldername(name))[2])
  );

drop policy if exists "clients remove own shipment uploads" on storage.objects;
create policy "clients remove own shipment uploads" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shipment-documents'
    and (storage.foldername(name))[1] = 'portal'
    and public.client_owns_job((storage.foldername(name))[2])
  );

create or replace function public.portal_add_shipment_document(
  p_job uuid, p_name text, p_path text, p_doc_type text, p_size bigint
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  v_id uuid;
  v_ref text;
begin
  if cid is null then
    raise exception 'Only a customer portal login can upload here';
  end if;
  select reference into v_ref from public.jobs where id = p_job and client_id = cid;
  if v_ref is null then
    raise exception 'Shipment not found';
  end if;
  if p_doc_type not in ('Commercial Invoice', 'Packing List', 'HAWB', 'HBL') then
    raise exception 'Upload a Commercial Invoice, Packing List, HAWB or HBL here';
  end if;
  if p_path is null or p_path not like 'portal/' || p_job::text || '/%' then
    raise exception 'Upload the file to this shipment first';
  end if;
  insert into public.shipment_documents (job_id, name, storage_path, kind, doc_type, size_bytes,
                                         visible_to_client, from_client)
  values (p_job, coalesce(nullif(btrim(p_name), ''), 'Document'), p_path, 'upload', p_doc_type, p_size, true, true)
  returning id into v_id;

  -- ExPac: a task to check what the customer sent.
  insert into public.ops_tasks (kind, title, body, status, priority, job_id, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Customer uploaded ' || p_doc_type || ' on ' || v_ref,
          'File: ' || coalesce(p_name, '') || '. Check it on the shipment''s documents.',
          'open', 'normal', p_job, cid, false, false, auth.uid());
  return v_id;
end;
$$;
grant execute on function public.portal_add_shipment_document(uuid, text, text, text, bigint) to authenticated;

create or replace function public.portal_delete_shipment_document(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_path text;
begin
  delete from public.shipment_documents d
   using public.jobs j
   where d.id = p_id and j.id = d.job_id and j.client_id = public.my_client_id() and d.from_client
  returning d.storage_path into v_path;
  if v_path is null then
    raise exception 'You can only remove documents you uploaded';
  end if;
  return v_path;
end;
$$;
grant execute on function public.portal_delete_shipment_document(uuid) to authenticated;

-- The portal list knows which files the customer sent.
create or replace view public.client_documents
with (security_barrier = true) as
select sd.id, sd.job_id, sd.name, sd.storage_path, sd.kind, sd.doc_type,
       sd.size_bytes, sd.created_at, sd.from_client
from public.shipment_documents sd
join public.jobs j on j.id = sd.job_id
where j.client_id = public.my_client_id() and sd.visible_to_client = true;
grant select on public.client_documents to authenticated;

notify pgrst, 'reload schema';
