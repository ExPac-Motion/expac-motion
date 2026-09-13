-- ============================================================
-- 0080  Ops Tasks — link to a Lead
-- ============================================================
-- Tasks could already be pinned to a job / quote / customer; leads were
-- missing, so a follow-up couldn't be scheduled on a lead that hasn't been
-- quoted yet (the Leads table's new "Create Task" row action needs this).
-- Self-contained & idempotent.

alter table public.ops_tasks
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

create index if not exists ops_tasks_lead_idx
  on public.ops_tasks (lead_id);
