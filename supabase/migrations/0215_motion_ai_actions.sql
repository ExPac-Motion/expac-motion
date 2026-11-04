-- ============================================================
-- 0215  Motion AI, stage 2: actions, autonomy levels, approvals
-- ============================================================
-- Every change a bot wants to make becomes a row in ai_actions. Its
-- autonomy level (ai_action_policies, per bot + action) decides what happens:
--   suggest = only described in chat, recorded for the trust scorecard
--   draft   = an approval card: Approve / Edit / Reject (the default)
--   auto    = done straight away, logged, with Undo where possible
-- External email (stage 3) is locked to draft: it can't be promoted.
--
-- Approved actions run with the APPROVER's login (RLS + history show a
-- real person). Only the Edge Functions write ai_actions (service key);
-- staff with Motion AI access can read them.
--
-- Run in the Supabase SQL editor after 0214. Self-contained & idempotent.

-- ---------- 1. Autonomy levels ----------
create table if not exists public.ai_action_policies (
  bot_key     text not null references public.ai_bots (key) on delete cascade,
  action      text not null,
  label       text not null,
  level       text not null default 'draft' check (level in ('suggest', 'draft', 'auto')),
  -- Locked = can never be set to auto (external email in phase 1).
  locked      boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  primary key (bot_key, action),
  check (not (locked and level = 'auto'))
);

insert into public.ai_action_policies (bot_key, action, label, level, locked) values
  ('ops', 'create_task', 'Create a task', 'draft', false),
  ('ops', 'create_note', 'Create a note', 'draft', false),
  ('ops', 'update_shipment_status', 'Update a shipment status', 'draft', false),
  ('ops', 'draft_quote', 'Draft a quotation', 'draft', false),
  ('ops', 'draft_email', 'Email a customer or supplier', 'draft', true)
on conflict (bot_key, action) do nothing;

alter table public.ai_action_policies enable row level security;
drop policy if exists "motion ai read" on public.ai_action_policies;
create policy "motion ai read" on public.ai_action_policies
  for select to authenticated using (public.can_use_motion_ai());
drop policy if exists "admin update" on public.ai_action_policies;
create policy "admin update" on public.ai_action_policies
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 2. Actions (approval queue + oversight history) ----------
create table if not exists public.ai_actions (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  bot_key          text not null references public.ai_bots (key),
  conversation_id  uuid references public.ai_conversations (id) on delete set null,
  tool             text not null,
  -- One plain line for cards and the dashboard, e.g.
  -- 'Set SEA104512 from "In Transit" to "Arrived"'.
  summary          text not null,
  input            jsonb not null,
  edited_input     jsonb,              -- what a person changed before approving
  level            text not null check (level in ('suggest', 'draft', 'auto')),
  status           text not null default 'pending'
                   check (status in ('suggested', 'pending', 'executed', 'rejected', 'undone', 'failed')),
  -- What it points at, for links: 'job' | 'quote' | 'client' | 'task'.
  target_type      text,
  target_id        uuid,
  target_ref       text,               -- e.g. SEA104512
  actor_type       text not null default 'user' check (actor_type in ('user', 'trigger', 'schedule', 'system')),
  requested_by     uuid references public.profiles (id) on delete set null,
  trigger_key      text,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  reject_reason    text,
  executed_at      timestamptz,
  result           jsonb,
  undo             jsonb,              -- what Undo needs; null = can't be undone
  undone_by        uuid references public.profiles (id) on delete set null,
  undone_at        timestamptz,
  error            text,
  -- The chat already told the bot how this was decided (see engine).
  reported         boolean not null default false
);
create index if not exists ai_actions_status_idx on public.ai_actions (status, created_at desc);
create index if not exists ai_actions_conv_idx on public.ai_actions (conversation_id);
create index if not exists ai_actions_created_idx on public.ai_actions (created_at desc);

alter table public.ai_actions enable row level security;
drop policy if exists "motion ai read" on public.ai_actions;
create policy "motion ai read" on public.ai_actions
  for select to authenticated using (public.can_use_motion_ai());
-- No insert / update / delete policies: only the Edge Functions write.

-- ---------- 3. Shipment status, the same way the board does it ----------
-- Sets the status, the milestone and a milestone-log row; the timeline
-- trigger (0196) then ticks the steps. Runs as the caller (RLS applies).
create or replace function public.ai_set_shipment_status(p_job uuid, p_status text, p_note text default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  st text := btrim(coalesce(p_status, ''));
  ms text;
begin
  if st = '' then
    raise exception 'A status is required.';
  end if;
  ms := public.milestone_for_status(st);
  update public.jobs set shipment_status = st, milestone = coalesce(ms, milestone) where id = p_job;
  if not found then
    raise exception 'Shipment not found or not allowed.';
  end if;
  insert into public.job_events (job_id, milestone, note)
  select p_job, j.milestone, coalesce(p_note, 'Shipment Status set to "' || st || '"')
    from public.jobs j where j.id = p_job;
  return st;
end;
$$;
revoke execute on function public.ai_set_shipment_status(uuid, text, text) from public, anon;
grant execute on function public.ai_set_shipment_status(uuid, text, text) to authenticated;

-- ---------- 4. Trust scorecard ----------
-- Per action: how often people approved as-is, edited, rejected, undid.
-- Feeds "ready for auto?" in Settings > Motion AI.
create or replace view public.ai_action_scorecard
with (security_invoker = true) as
select
  a.bot_key,
  a.tool as action,
  count(*) filter (where a.status in ('executed', 'undone') and a.level = 'draft' and a.edited_input is null) as approved_as_is,
  count(*) filter (where a.status in ('executed', 'undone') and a.level = 'draft' and a.edited_input is not null) as approved_edited,
  count(*) filter (where a.status = 'rejected') as rejected,
  count(*) filter (where a.status = 'undone') as undone,
  count(*) filter (where a.status = 'failed') as failed,
  count(*) filter (where a.level = 'auto' and a.status in ('executed', 'undone')) as auto_done,
  count(*) filter (where a.status = 'pending') as pending,
  -- Approvals in a row since the last edit / reject / undo.
  (select count(*) from public.ai_actions b
    where b.bot_key = a.bot_key and b.tool = a.tool and b.status = 'executed' and b.level = 'draft'
      and b.edited_input is null
      and b.created_at > coalesce((
        select max(c.created_at) from public.ai_actions c
         where c.bot_key = a.bot_key and c.tool = a.tool
           and (c.status in ('rejected', 'undone', 'failed') or c.edited_input is not null)
      ), '-infinity'::timestamptz)) as streak
from public.ai_actions a
group by a.bot_key, a.tool;

-- ---------- 5. Live updates ----------
do $$
declare
  t text;
begin
  foreach t in array array['ai_actions', 'ai_action_policies'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------- 6. Bot prompt: it can now act ----------
update public.ai_bots
   set allowed_tools = (
         select array_agg(distinct t order by t)
           from unnest(allowed_tools || array['create_task', 'create_note', 'update_shipment_status']) as t
       ),
       system_prompt = replace(
         system_prompt,
         '- You cannot yet change data. If the user asks you to create, update or send something, explain that this arrives in the next stage, and describe exactly what you would do.',
         '- You can create tasks and notes and update shipment statuses with your action tools. Each action follows its autonomy level: it may run straight away, become an approval card for a person, or be suggest-only. Read the tool result and tell the user plainly which happened. Never claim something was done when it is waiting for approval.
- Before changing a shipment status, look the shipment up so you know its current status. Only use the exact status names.
- Drafting quotations and emails arrives in the next stage; for now describe what you would draft.'
       ),
       updated_at = now()
 where key = 'ops';
