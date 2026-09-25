-- ============================================================
-- 0101  Keep more shipment fields in sync with their quote
-- ============================================================
-- 0100 added a trigger that keeps a shipment's Shipper synced with its
-- quote after acceptance. Extend the same treatment to the rest of the
-- fields accept_quote() only ever copies once at job-creation time:
-- Customer, Origin/Destination, Mode, Carrier (Agent/Airline Name +
-- Carrier/shipping line), Vessel, Container (number + type), ETD/ETA —
-- so correcting any of these on an accepted quote also corrects the
-- live shipment from then on, not just the Shipper.
--
-- This supersedes the 0100 trigger with one function covering all of the
-- above plus supplier_id.
--
-- Run in the Supabase SQL editor after 0100. Self-contained & idempotent.

drop trigger if exists trg_quote_supplier_sync on public.quotes;
drop function if exists public.sync_quote_supplier_to_job();

create or replace function public.sync_quote_fields_to_job()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.supplier_id    is distinct from old.supplier_id
  or new.client_id      is distinct from old.client_id
  or new.origin         is distinct from old.origin
  or new.destination    is distinct from old.destination
  or new.mode           is distinct from old.mode
  or new.carrier_name   is distinct from old.carrier_name
  or new.shipping_line  is distinct from old.shipping_line
  or new.vessel_name    is distinct from old.vessel_name
  or new.container_no   is distinct from old.container_no
  or new.container_type is distinct from old.container_type
  or new.etd            is distinct from old.etd
  or new.eta            is distinct from old.eta
  then
    update public.jobs
       set supplier_id    = new.supplier_id,
           client_id      = coalesce(new.client_id, client_id),
           origin         = new.origin,
           destination    = new.destination,
           mode           = new.mode,
           carrier_name   = nullif(new.carrier_name, ''),
           shipping_line  = nullif(new.shipping_line, ''),
           vessel_name    = nullif(new.vessel_name, ''),
           container_no   = nullif(new.container_no, ''),
           container_type = nullif(new.container_type, ''),
           etd            = new.etd,
           eta            = new.eta
     where quote_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_quote_fields_sync on public.quotes;
create trigger trg_quote_fields_sync
  after update of
    supplier_id, client_id, origin, destination, mode,
    carrier_name, shipping_line, vessel_name,
    container_no, container_type, etd, eta
  on public.quotes
  for each row
  execute function public.sync_quote_fields_to_job();

-- Backfill: shipments whose fields have already gone stale against their quote.
update public.jobs j
   set supplier_id    = q.supplier_id,
       client_id      = coalesce(q.client_id, j.client_id),
       origin         = q.origin,
       destination    = q.destination,
       mode           = q.mode,
       carrier_name   = nullif(q.carrier_name, ''),
       shipping_line  = nullif(q.shipping_line, ''),
       vessel_name    = nullif(q.vessel_name, ''),
       container_no   = nullif(q.container_no, ''),
       container_type = nullif(q.container_type, ''),
       etd            = q.etd,
       eta            = q.eta
  from public.quotes q
 where j.quote_id = q.id;
