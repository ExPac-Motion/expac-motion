-- 0212: Live WMS. The Motion WMS tables join the supabase_realtime
-- publication, so a receipt, stock move, release, consol, cycle count,
-- billing run, pre-advice, release request or service request saved in one
-- tab shows on every open staff screen and in the customer portal at once,
-- instead of only after a reload. Same pattern as 0198 / 0203; RLS still
-- decides who receives each change (a customer only hears about their own
-- rows). Run in the Supabase SQL editor after 0211. Safe to run more than once.

do $$
declare
  t text;
begin
  foreach t in array array[
    'wms_warehouses', 'wms_locations',
    'wms_receipts', 'wms_receipt_images', 'wms_stock_moves', 'wms_movements',
    'wms_releases', 'wms_release_lines', 'wms_release_requests', 'wms_preadvices',
    'wms_consols', 'wms_consol_houses',
    'wms_counts', 'wms_count_lines',
    'wms_billing_runs', 'wms_service_requests'
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
