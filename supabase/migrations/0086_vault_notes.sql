-- ============================================================
-- 0086  Personal Vault — private Notes & Calendar
-- ============================================================
-- A personal task/note list, same shape as the shared Control Tower
-- ops_tasks but entirely private and unlinked — no job/quote/client/lead/
-- supplier/assignee columns, because this never appears anywhere else in
-- the system. Every row is scoped by RLS (user_id = auth.uid()), same
-- privacy model as the rest of Personal Vault.
--
-- Run in the Supabase SQL editor after 0085. Self-contained & idempotent.

create table if not exists public.vault_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade
              default auth.uid(),
  kind        text not null default 'task',      -- 'task' | 'note'
  title       text not null,
  body        text,
  status      text not null default 'open',      -- 'open' | 'doing' | 'done'
  priority    text not null default 'normal',    -- 'low' | 'normal' | 'high'
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists vault_notes_user_status_due_idx
  on public.vault_notes (user_id, status, due_date);

alter table public.vault_notes enable row level security;
drop policy if exists "own rows" on public.vault_notes;
create policy "own rows" on public.vault_notes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
