-- ============================================================
-- 0055  Shipments inherit the shipper (supplier) from the quote
-- ============================================================
-- accept_quote() was rewritten in 0022 and the jobs INSERT lost the
-- supplier_id it used to copy from the quote (0007/0008 had it). Since
-- then, every shipment created from an accepted quote shows Shipper = "—"
-- even when the quotation has one set. Restore the column on the INSERT
-- and backfill jobs whose quote has a shipper but the job doesn't.
--
-- Run in the Supabase SQL editor after 0054. Self-contained & idempotent.

create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id    uuid;
  v_client_id uuid;
  q           public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  v_client_id := q.client_id;
  if v_client_id is null and q.lead_id is not null then
    v_client_id := public.promote_lead_to_customer(q.lead_id);
  end if;

  update public.quotes
     set status = 'accepted',
         client_id = v_client_id,
         accepted_at = coalesce(accepted_at, now()),
         updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, po_no, client_id, supplier_id,
       origin, destination, mode, milestone)
    values
      (q.id, q.reference, nullif(trim(q.customer_reference), ''),
       v_client_id, q.supplier_id, q.origin, q.destination, q.mode, 'Booked')
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');

    insert into public.ops_tasks (kind, title, status, priority, job_id, quote_id, client_id)
    values
      ('task', 'Request commercial invoice', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Book carrier', 'open', 'normal', v_job_id, q.id, v_client_id),
      ('task', 'Send booking confirmation to customer', 'open', 'normal', v_job_id, q.id, v_client_id);
  end if;

  return v_job_id;
end;
$$;

-- Backfill: shipments missing a shipper whose quote has one.
update public.jobs j
   set supplier_id = q.supplier_id
  from public.quotes q
 where j.quote_id = q.id
   and j.supplier_id is null
   and q.supplier_id is not null;
