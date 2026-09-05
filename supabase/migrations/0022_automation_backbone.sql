-- ============================================================
-- 0022  Automation backbone: auto-tasks on quote acceptance
-- ============================================================
-- Extends accept_quote() so a newly-created shipment gets a standard set
-- of Control Tower tasks automatically, instead of someone typing them in
-- by hand every time. Milestone advancement is wired on the client side
-- (JobsBoard calls the existing set_job_milestone RPC when Shipment Status
-- changes) — no schema change needed for that half.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id uuid;
  q        public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  update public.quotes
     set status = 'accepted', updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, client_id, origin, destination, mode, milestone)
    values
      (q.id, q.reference, q.client_id, q.origin, q.destination, q.mode, 'Booked')
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');

    insert into public.ops_tasks (kind, title, status, priority, job_id, quote_id, client_id)
    values
      ('task', 'Request commercial invoice', 'open', 'normal', v_job_id, q.id, q.client_id),
      ('task', 'Book carrier', 'open', 'normal', v_job_id, q.id, q.client_id),
      ('task', 'Send booking confirmation to customer', 'open', 'normal', v_job_id, q.id, q.client_id);
  end if;

  return v_job_id;
end;
$$;
