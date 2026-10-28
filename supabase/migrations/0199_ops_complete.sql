-- ============================================================
-- 0199  Ops Complete: Admin signs a shipment off
-- ============================================================
-- Delivered is now just a status: a delivered shipment stays on Active
-- Shipments until Admin marks it Ops Complete (customer invoiced, all
-- supplier invoices accounted for). Only then does it move to Completed
-- Shipments and drop out of the active counts.
--
--   * jobs.ops_completed_at / ops_completed_by.
--   * Only Admin can set or clear them (trigger; RLS lets staff update jobs).
--   * Existing delivered shipments are signed off once, so Completed
--     Shipments looks as before; anything delivered from now on waits.
--   * nav_counts: active = not Ops Complete (was: status <> Delivered).
--
-- Run in the Supabase SQL editor after 0198. Self-contained & idempotent.

alter table public.jobs
  add column if not exists ops_completed_at timestamptz,
  add column if not exists ops_completed_by uuid references auth.users (id) on delete set null;
create index if not exists jobs_ops_completed_idx on public.jobs (ops_completed_at);

create or replace function public.guard_ops_complete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ops_completed_at is distinct from old.ops_completed_at
     or new.ops_completed_by is distinct from old.ops_completed_by then
    -- auth.uid() is null for the SQL editor / service jobs: allowed.
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Only Admin can mark a shipment Ops Complete or reopen it';
    end if;
    if new.ops_completed_at is not null and old.ops_completed_at is null then
      new.ops_completed_by := coalesce(new.ops_completed_by, auth.uid());
    end if;
    if new.ops_completed_at is null then
      new.ops_completed_by := null;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ops_complete on public.jobs;
create trigger trg_guard_ops_complete
  before update of ops_completed_at, ops_completed_by on public.jobs
  for each row execute function public.guard_ops_complete();

-- One-time: shipments already delivered stay on Completed Shipments.
update public.jobs
   set ops_completed_at = coalesce(pod_delivered_at::timestamptz, now())
 where ops_completed_at is null
   and (coalesce(shipment_status, '') = 'Delivered' or milestone = 'Delivered');

-- Menu counts: active = not Ops Complete. Same as the live 0193 version
-- (incl. the BDR counts), only the four shipment counts change.
create or replace function public.nav_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'jobs_active',     (select count(*) from public.jobs j where j.ops_completed_at is null),
    'jobs_air',        (select count(*) from public.jobs j where j.ops_completed_at is null and j.mode like 'Air%'),
    'jobs_courier',    (select count(*) from public.jobs j where j.ops_completed_at is null and j.mode like 'Courier%'),
    'jobs_sea',        (select count(*) from public.jobs j where j.ops_completed_at is null and j.mode like 'Sea%'),
    'jobs_road',       (select count(*) from public.jobs j where j.ops_completed_at is null and j.mode like 'Road%'),
    'quotes_open',     (select count(*) from public.quotes q where q.status = 'open'),
    'quotes_sent',     (select count(*) from public.quotes q where q.status = 'sent'),
    'quotes_accepted', (select count(*) from public.quotes q where q.status = 'accepted'),
    'quotes_bdr',      (select count(*) from public.quotes q
                         where q.status = 'open' and q.bdr_requested_at is not null
                           and not exists (select 1 from public.quote_lines ql where ql.quote_id = q.id)),
    'tasks_open',      (select count(*) from public.ops_tasks t where t.status <> 'done'),
    'chat_unread',     (select count(*) from public.client_chat c where c.direction = 'in' and c.read_at is null),
    'portal_pending',  (select count(*) from public.profiles p where p.portal_status = 'pending' and public.is_staff()),
    'leads_total',     (select count(*) from public.leads l where l.promoted_client_id is null),
    'clients_total',   (select count(*) from public.clients),
    'suppliers_total', (select count(*) from public.suppliers),
    'bdr_quotes_open', (select count(*) from public.bdr_quotes b where b.status in ('open', 'sent'))
  );
$$;
grant execute on function public.nav_counts() to authenticated;

notify pgrst, 'reload schema';
