-- ============================================================
-- 0082  Ops Tasks — link to a Supplier
-- ============================================================
-- Extends the "Create a task" row action (already on Leads, via lead_id in
-- 0080) to Quotations, Shipments, Customers and Suppliers. Quotes/Shipments
-- reuse the existing job_id/quote_id/client_id links; Customers reuses
-- client_id; Suppliers needed a new link since ops_tasks had no supplier_id.
--
-- Run in the Supabase SQL editor after 0081. Self-contained & idempotent.

alter table public.ops_tasks
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists ops_tasks_supplier_idx
  on public.ops_tasks (supplier_id);
