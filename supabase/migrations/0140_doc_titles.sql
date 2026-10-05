-- 0140: editable titles for the Document Vault's generated documents
-- (Delivery Release Order, Arrival Notification, …), company-wide.
-- { "<slug>": "<title>" } — a missing slug keeps the built-in title.
alter table public.company_settings
  add column if not exists doc_titles jsonb not null default '{}'::jsonb;
