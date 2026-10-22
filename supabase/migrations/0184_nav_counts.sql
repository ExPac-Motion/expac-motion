-- 0184: counts on the top menu (like the Inbox's unread count on Sales CRM).
--   One light call, made every minute by the app on every page:
--     jobs_*         active shipments (not Delivered), in total and per mode,
--                    as on Shipments › Active Shipments / Air / Sea / Road / Courier
--     quotes_*       quotations at New Lead, Quote Sent and Quote Accepted
--     tasks_open     Control Tower tasks not done
--     chat_unread    unread Customer Messages (portal general chat)
--   security invoker: each count only sees what the caller may see (RLS),
--   so a login without access to an area gets 0 there.

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
    'chat_unread',     (select count(*) from public.client_chat c where c.direction = 'in' and c.read_at is null)
  );
$$;
grant execute on function public.nav_counts() to authenticated;

notify pgrst, 'reload schema';
