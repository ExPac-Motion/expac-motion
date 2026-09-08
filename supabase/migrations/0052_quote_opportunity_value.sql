-- 0052  TEMP: manual opportunity value on a quote (old-CRM migration aid)
--
-- While the historical book of business is being loaded from the previous
-- CRM, operators are entering shipments (Completed / Not Proceeding, this
-- year) as bare quotes WITHOUT charge lines. This column lets them type the
-- deal value straight onto the Opportunities board card instead.
--
-- The Opportunities card shows `opportunity_value` when set, otherwise it
-- falls back to the computed quotation total (incl. VAT). Nothing else reads
-- it, and `save_quote` never touches it, so a later full costing of the same
-- quote leaves the manual figure intact until it is cleared.
--
-- Safe to drop once the migration is done:
--   alter table public.quotes drop column if exists opportunity_value;
--
-- Run in the Supabase SQL editor after 0051. Self-contained & idempotent.

alter table public.quotes
  add column if not exists opportunity_value numeric;

comment on column public.quotes.opportunity_value is
  'TEMP (0052): manual deal value for the Opportunities board while the old '
  'CRM is being migrated. NULL = use the computed quotation total.';
