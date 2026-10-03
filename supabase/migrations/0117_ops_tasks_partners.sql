-- ============================================================
-- 0117  Ops Tasks — link to an Agent / Transporter / Clearing Agent
-- ============================================================
-- Extends the "Create a task" row action (Leads / Quotes / Shipments /
-- Customers / Shippers) to the three partner lists, same pattern as the
-- supplier link in 0082.
--
-- Run in the Supabase SQL editor after 0116. Self-contained & idempotent.

alter table public.ops_tasks
  add column if not exists agent_id          uuid references public.agents (id) on delete set null,
  add column if not exists transporter_id    uuid references public.transporters (id) on delete set null,
  add column if not exists clearing_agent_id uuid references public.clearing_agents (id) on delete set null;

create index if not exists ops_tasks_agent_idx          on public.ops_tasks (agent_id);
create index if not exists ops_tasks_transporter_idx    on public.ops_tasks (transporter_id);
create index if not exists ops_tasks_clearing_agent_idx on public.ops_tasks (clearing_agent_id);
