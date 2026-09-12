-- ============================================================
-- 0078  Notifications interaction state + task fields
-- ============================================================
-- The Notifications feed itself is computed from existing tables (leads,
-- quotes, jobs, job_events, messages, shipment_documents, ops_tasks) --
-- no new event-logging system. This table only holds the small bit of
-- state that doesn't exist anywhere yet: whether a given feed item has
-- been read/archived. Shared/team-wide, same as messages.read_at.
--
-- Also extends ops_tasks: assigned_to (richer task fields) and
-- source_notification_key (traces a task back to the notification it was
-- created from).
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

create table if not exists public.notification_state (
  notification_key text primary key,
  read_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.notification_state enable row level security;
drop policy if exists "team full access" on public.notification_state;
create policy "team full access" on public.notification_state
  for all to authenticated using (true) with check (true);

alter table public.ops_tasks add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.ops_tasks add column if not exists source_notification_key text;
