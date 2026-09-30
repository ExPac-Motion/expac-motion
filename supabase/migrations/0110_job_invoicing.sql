-- Invoicing on shipments, for the Sales CRM Financial Snapshot
-- ("Unbilled Jobs", "Completed Not Invoiced"). Entered by hand on the
-- Active / Completed Shipments boards for now; a future Sage Accounting
-- integration is expected to populate the same two columns.
--
-- Run in the Supabase SQL editor after 0109. Self-contained & idempotent.

alter table public.jobs
  add column if not exists invoiced_at date,
  add column if not exists invoice_no  text;

notify pgrst, 'reload schema';
