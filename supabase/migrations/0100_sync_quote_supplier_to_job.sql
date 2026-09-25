-- ============================================================
-- 0100  Keep a shipment's Shipper in sync with its quote
-- ============================================================
-- accept_quote() only ever copies quotes.supplier_id onto jobs.supplier_id
-- once, at the moment the shipment is created (see 0055/0090). Editing the
-- Shipper on an already-accepted quote (e.g. correcting it on SEA923778)
-- silently diverges from Active Shipments from then on, since save_quote()
-- only ever writes to quotes/quote_lines/packing_list_items.
--
-- Add a trigger that pushes quotes.supplier_id onto its linked job whenever
-- it changes, and backfill any shipment that's already gone stale.
--
-- Run in the Supabase SQL editor after 0099. Self-contained & idempotent.

create or replace function public.sync_quote_supplier_to_job()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.supplier_id is distinct from old.supplier_id then
    update public.jobs
       set supplier_id = new.supplier_id
     where quote_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_quote_supplier_sync on public.quotes;
create trigger trg_quote_supplier_sync
  after update of supplier_id on public.quotes
  for each row
  execute function public.sync_quote_supplier_to_job();

-- Backfill: shipments whose Shipper has already gone stale against their quote.
update public.jobs j
   set supplier_id = q.supplier_id
  from public.quotes q
 where j.quote_id = q.id
   and j.supplier_id is distinct from q.supplier_id;
