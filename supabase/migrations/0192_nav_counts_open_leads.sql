-- 0192: the Sales CRM › Leads count is open leads only (not yet made a
-- customer), matching the Leads list. Otherwise the same as 0190.
-- security invoker: each count only sees what the caller may see (RLS).
-- Self-contained & idempotent.

create or replace function public.nav_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'jobs_active',     (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered'),
    'jobs_air',        (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Air%'),
    'jobs_courier',    (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Courier%'),
    'jobs_sea',        (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Sea%'),
    'jobs_road',       (select count(*) from public.jobs j where coalesce(j.shipment_status, '') <> 'Delivered' and j.mode like 'Road%'),
    'quotes_open',     (select count(*) from public.quotes q where q.status = 'open'),
    'quotes_sent',     (select count(*) from public.quotes q where q.status = 'sent'),
    'quotes_accepted', (select count(*) from public.quotes q where q.status = 'accepted'),
    'tasks_open',      (select count(*) from public.ops_tasks t where t.status <> 'done'),
    'chat_unread',     (select count(*) from public.client_chat c where c.direction = 'in' and c.read_at is null),
    'portal_pending',  (select count(*) from public.profiles p where p.portal_status = 'pending' and public.is_staff()),
    'leads_total',     (select count(*) from public.leads l where l.promoted_client_id is null),
    'clients_total',   (select count(*) from public.clients),
    'suppliers_total', (select count(*) from public.suppliers)
  );
$$;
grant execute on function public.nav_counts() to authenticated;

notify pgrst, 'reload schema';

-- Check:
select public.nav_counts();
