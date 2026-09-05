-- ============================================================
-- 0024  Document Vault: per-shipment file storage
-- ============================================================
-- Phase 2, module 3. A private Supabase Storage bucket holds the actual
-- files; shipment_documents is the metadata row (name, path, who/when) so
-- the Shipments board can list/download/delete per shipment. Template
-- documents (Delivery Instructions etc.) are generated in the browser as
-- a print-to-PDF page (same pattern as the Quotation letterhead) — the
-- resulting PDF is then uploaded here like any other file.
--
-- Run in the Supabase SQL editor after 0023. Self-contained & idempotent.

insert into storage.buckets (id, name, public)
values ('shipment-documents', 'shipment-documents', false)
on conflict (id) do nothing;

drop policy if exists "shipment-documents team access" on storage.objects;
create policy "shipment-documents team access" on storage.objects
  for all to authenticated
  using (bucket_id = 'shipment-documents')
  with check (bucket_id = 'shipment-documents');

create table if not exists public.shipment_documents (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  kind         text not null default 'upload', -- 'upload' | 'generated'
  doc_type     text,                            -- e.g. 'delivery_instruction'
  size_bytes   bigint,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists shipment_documents_job_idx
  on public.shipment_documents (job_id);

alter table public.shipment_documents enable row level security;
drop policy if exists "team full access" on public.shipment_documents;
create policy "team full access" on public.shipment_documents
  for all to authenticated using (true) with check (true);
