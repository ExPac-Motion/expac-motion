-- 0143: Portal Shipments board = the Active Shipments board for the
-- customer (read only): their reference (po_no) on client_jobs, Shipment
-- Comms per shipment (client_messages / client_send_message, 0026) and
-- shipment tasks — the customer asks ExPac for something on a shipment, and
-- ExPac can show its own shipment tasks to the customer.

-- Customer view of shipments + their own reference (appended column).
create or replace view public.client_jobs
with (security_barrier = true) as
select j.id, j.reference, j.client_id, j.mode, j.milestone, j.shipment_status,
       j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name,
       j.carrier_name, j.provisional_delivery_date, j.etd, j.eta,
       j.origin, j.destination, j.created_at,
       s.company as supplier_company,
       j.po_no
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();
grant select on public.client_jobs to authenticated;

alter table public.ops_tasks
  add column if not exists portal_visible boolean not null default false,
  add column if not exists from_portal boolean not null default false;

-- Shipment tasks the customer can see: its own requests + ones ExPac shares.
create or replace view public.client_tasks
with (security_barrier = true) as
select t.id, t.job_id, t.title, t.body, t.status, t.due_date, t.created_at, t.done_at, t.from_portal
from public.ops_tasks t
join public.jobs j on j.id = t.job_id
where j.client_id = public.my_client_id()
  and t.kind = 'task'
  and (t.portal_visible or t.from_portal);
grant select on public.client_tasks to authenticated;

create or replace function public.portal_create_task(p_job uuid, p_title text, p_body text, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_client_id();
  tid uuid;
begin
  if cid is null or not exists (select 1 from public.jobs where id = p_job and client_id = cid) then
    raise exception 'Shipment not found';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'What do you need? (title)';
  end if;
  insert into public.ops_tasks (kind, title, body, status, priority, due_date, job_id, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', trim(p_title), nullif(trim(p_body), ''), 'open', 'normal', p_due, p_job, cid,
          true, true, auth.uid())
  returning id into tid;
  return tid;
end;
$$;
grant execute on function public.portal_create_task(uuid, text, text, date) to authenticated;
