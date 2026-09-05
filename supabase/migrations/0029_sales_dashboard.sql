-- ============================================================
-- 0029  Sales CRM Dashboard: revenue/GP/leads targets
-- ============================================================
-- Phase 2 of the Sales CRM brief. Real computed figures, not placeholders:
-- Revenue and Gross Profit need to know WHEN a quote was won, which
-- wasn't tracked before (only "currently accepted", not "accepted this
-- month") — accepted_at fixes that. Targets are simple company-wide
-- monthly goals, added onto the existing company_settings singleton
-- rather than a new table for three numbers.
--
-- Run in the Supabase SQL editor after 0028. Self-contained & idempotent.

alter table public.quotes add column if not exists accepted_at timestamptz;

alter table public.company_settings
  add column if not exists sales_revenue_target numeric not null default 0,
  add column if not exists sales_gp_target numeric not null default 0,
  add column if not exists sales_new_leads_target numeric not null default 0;

-- accept_quote(): stamp accepted_at the first time a quote is accepted
-- (coalesce so re-running it, e.g. re-accepting after some future edit,
-- never overwrites the original win date).
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
      (quote_id, reference, client_id, origin, destination, mode, milestone)
    values
      (q.id, q.reference, v_client_id, q.origin, q.destination, q.mode, 'Booked')
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
