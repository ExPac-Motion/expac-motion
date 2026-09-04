-- ============================================================
-- 0017  Operations Control Tower — Tasks & Notes
-- ============================================================
-- One table for the operator's task list and dated notes. A "note" is
-- just a task with kind = 'note' (no status workflow); a note with a
-- due_date shows up on the Calendar module. Tasks can be pinned to a
-- job / quote / customer so the Control Tower can link back into the app.
--
-- Plain CRUD from the client (RLS: team full access) — no RPC.
-- Run in the Supabase SQL editor after 0016. Self-contained & idempotent.

create table if not exists public.ops_tasks (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'task',      -- 'task' | 'note'
  title       text not null,
  body        text,
  status      text not null default 'open',      -- 'open' | 'doing' | 'done'
  priority    text not null default 'normal',    -- 'low' | 'normal' | 'high'
  due_date    date,
  job_id      uuid references public.jobs (id)    on delete set null,
  quote_id    uuid references public.quotes (id)  on delete set null,
  client_id   uuid references public.clients (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);

create index if not exists ops_tasks_status_due_idx
  on public.ops_tasks (status, due_date);
create index if not exists ops_tasks_job_idx
  on public.ops_tasks (job_id);

alter table public.ops_tasks enable row level security;
drop policy if exists "team full access" on public.ops_tasks;
create policy "team full access" on public.ops_tasks
  for all to authenticated using (true) with check (true);
