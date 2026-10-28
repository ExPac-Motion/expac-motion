-- ============================================================
-- 0198  Shipment <-> quotation kept in sync both ways + live updates
-- ============================================================
-- Until now only an accepted quote's edits reached its shipment (0101),
-- and not PDD, MBL/AWB or the customer reference. Edits made on the
-- shipment (Quick update, the View / workspace cards, the timeline's
-- ETD / ETA / PDD) never reached the quotation, so the two drifted.
--
--   1. Quote -> shipment (0101's trigger) now also carries PDD, MBL/AWB
--      and the customer reference (PO).
--   2. Shipment -> quote: a new trigger copies the shipment's booking
--      fields back to its quotation.
--   Each trigger only acts on a direct edit (pg_trigger_depth() = 1), so
--   one side's update never bounces back and forth.
--   3. Realtime: shipments, quotes, timeline, tasks, documents and
--      history are published, so every open Motion screen refreshes when
--      anyone changes them (RLS still decides who receives what).
--
-- Run in the Supabase SQL editor after 0197. Self-contained & idempotent.

-- ---------- 1. Quote -> shipment ----------
create or replace function public.sync_quote_fields_to_job()
returns trigger
language plpgsql
security invoker
as $$
begin
  -- Only a direct quote edit; not the echo of a shipment edit (see 2).
  if pg_trigger_depth() > 1 then
    return null;
  end if;
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
  or new.provisional_delivery_date is distinct from old.provisional_delivery_date
  or new.mbl_no         is distinct from old.mbl_no
  or new.mawb_no        is distinct from old.mawb_no
  or new.customer_reference is distinct from old.customer_reference
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
           eta            = new.eta,
           provisional_delivery_date = new.provisional_delivery_date,
           -- one job field, from the mode's master bill; a blank bill keeps the job's
           awb_mbl        = coalesce(
                              nullif(case when new.mode ilike 'air%' or new.mode ilike 'courier%'
                                          then new.mawb_no else new.mbl_no end, ''),
                              awb_mbl),
           po_no          = coalesce(nullif(trim(new.customer_reference), ''), po_no)
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
    container_no, container_type, etd, eta,
    provisional_delivery_date, mbl_no, mawb_no, customer_reference
  on public.quotes
  for each row
  execute function public.sync_quote_fields_to_job();

-- ---------- 2. Shipment -> quote ----------
create or replace function public.sync_job_fields_to_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  air boolean := new.mode ilike 'air%' or new.mode ilike 'courier%';
begin
  -- Only a direct shipment edit; not the echo of a quote edit (see 1).
  if new.quote_id is null or pg_trigger_depth() > 1 then
    return null;
  end if;
  update public.quotes q
     set etd            = new.etd,
         eta            = new.eta,
         provisional_delivery_date = new.provisional_delivery_date,
         container_no   = coalesce(new.container_no, ''),
         container_type = coalesce(new.container_type, ''),
         shipping_line  = coalesce(new.shipping_line, ''),
         carrier_name   = coalesce(new.carrier_name, ''),
         vessel_name    = coalesce(new.vessel_name, ''),
         mbl_no         = case when air then q.mbl_no else coalesce(new.awb_mbl, '') end,
         mawb_no        = case when air then coalesce(new.awb_mbl, '') else q.mawb_no end,
         customer_reference = coalesce(new.po_no, ''),
         -- The shipment keeps just the port code: only a real change of port
         -- replaces the quote's "CODE, City, Country".
         origin         = case when upper(split_part(coalesce(q.origin, ''), ',', 1)) = upper(coalesce(new.origin, ''))
                                  or upper(coalesce(q.origin, '')) = upper(coalesce(new.origin, ''))
                               then q.origin else new.origin end,
         destination    = case when upper(split_part(coalesce(q.destination, ''), ',', 1)) = upper(coalesce(new.destination, ''))
                                  or upper(coalesce(q.destination, '')) = upper(coalesce(new.destination, ''))
                               then q.destination else new.destination end
   where q.id = new.quote_id;
  return null;
end;
$$;

drop trigger if exists trg_job_fields_sync on public.jobs;
create trigger trg_job_fields_sync
  after update of
    etd, eta, provisional_delivery_date, awb_mbl, container_no, container_type,
    shipping_line, carrier_name, vessel_name, po_no, origin, destination
  on public.jobs
  for each row
  execute function public.sync_job_fields_to_quote();

-- ---------- 3. Realtime ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'jobs', 'quotes', 'quote_lines', 'packing_list_items', 'job_timeline_steps',
    'job_events', 'ops_tasks', 'shipment_documents'
  ]
  loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
