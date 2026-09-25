-- Internal follow-up notes on a quotation (Quote view popup), separate from
-- the customer-facing document. Mirrors jobs.notes on Active Shipments.
alter table public.quotes
  add column if not exists notes text;
