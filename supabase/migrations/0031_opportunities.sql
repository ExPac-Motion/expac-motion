-- ============================================================
-- 0031  Sales CRM: Opportunities pipeline
-- ============================================================
-- Replaces the old "Opportunities" tab (a customer list + pipeline
-- modal, which was really just a rename of the existing Quotation
-- Pipeline concept) with a real Kanban-style sales pipeline, per the
-- Sales CRM brief's follow-up: a discrete opportunity record per deal,
-- created explicitly (e.g. "+ Add Opportunity" from an open lead), moved
-- between 5 fixed stages via a status dropdown on each card:
--   new_lead        -> New Lead - Enquiries
--   quote_sent      -> Quote Sent - Follow Up
--   quote_accepted  -> Quote Accepted - Job Active
--   job_completed   -> Job Completed - Shipment Delivered
--   not_proceeding  -> Not Proceeding - Keep In Contact
--
-- An opportunity is with either a lead or an existing client (at least
-- one should be set), and can optionally link to the quote/job that came
-- of it. The status is deliberately NOT auto-derived from the linked
-- quote/job state — the brief asks for a manual dropdown that moves the
-- card, not background automation fighting the user's own stage calls.
--
-- Run in the Supabase SQL editor after 0030. Self-contained & idempotent.

create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  lead_id         uuid references public.leads (id) on delete set null,
  client_id       uuid references public.clients (id) on delete set null,
  quote_id        uuid references public.quotes (id) on delete set null,
  job_id          uuid references public.jobs (id) on delete set null,
  status          text not null default 'new_lead'
                  check (status in ('new_lead', 'quote_sent', 'quote_accepted', 'job_completed', 'not_proceeding')),
  value           numeric not null default 0,
  close_date      date,
  notes           text,
  sales_person_id uuid references public.profiles (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists opportunities_status_idx on public.opportunities (status);
create index if not exists opportunities_lead_idx on public.opportunities (lead_id);
create index if not exists opportunities_client_idx on public.opportunities (client_id);

alter table public.opportunities enable row level security;
drop policy if exists "team full access" on public.opportunities;
create policy "team full access" on public.opportunities
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
