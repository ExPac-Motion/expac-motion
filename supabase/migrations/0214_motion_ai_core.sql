-- ============================================================
-- 0214  Motion AI, stage 1: settings, bots, conversations, audit log
-- ============================================================
-- The shared foundation every Motion AI bot runs on. Phase 1 seeds the
-- Operations bot only; the Sales and Support bots become rows in ai_bots
-- later, not new code.
--
-- Who writes what:
--   * The Edge Functions (supabase/functions/motion-ai-*) write
--     conversations, messages and the audit log with the service key.
--     Logged-in users can READ their own conversations but never write
--     or edit any of these tables, so the log can't be forged.
--   * Admins edit ai_settings and ai_bots (Settings > Motion AI).
--
-- Access: new staff permission 'motion_ai' (Roles & Permissions), off
-- for Standard Users by default, so Motion AI starts admin-only.
--
-- Run in the Supabase SQL editor after 0213. Self-contained & idempotent.

-- ---------- 1. Permission ----------
create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, public.has_perm(k))
  from unnest(array[
    'ops', 'shipments', 'quotes', 'warehouse', 'customs', 'customers', 'suppliers', 'leads', 'inbox',
    'rates', 'settings', 'crm', 'delete', 'motion_ai',
    'delete_sheets', 'edit_coverage', 'see_history'
  ]) as k;
$$;
grant execute on function public.my_permissions() to authenticated;

-- has_perm() has no default for 'motion_ai', so it is false for Standard
-- Users until switched on in Roles & Permissions or per login. Admin = true.
create or replace function public.can_use_motion_ai()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and public.has_perm('motion_ai'));
$$;
grant execute on function public.can_use_motion_ai() to authenticated;

-- ---------- 2. Settings (one row) ----------
create table if not exists public.ai_settings (
  id                 int primary key default 1 check (id = 1),
  enabled            boolean not null default true,
  -- Model per kind of work, editable in Settings (no deploy needed).
  --   chat: the chat panel; briefing: daily briefing; trigger: quick triage
  --   of events; deep: harder drafting work (quotes).
  models             jsonb not null default '{
    "chat": "claude-sonnet-5-5",
    "briefing": "claude-sonnet-5-5",
    "trigger": "claude-haiku-5-5",
    "deep": "claude-opus-5-5"
  }'::jsonb,
  effort             text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  -- USD per million tokens, used to cost each call in the audit log.
  model_prices       jsonb not null default '{
    "claude-opus-5-5":   {"in": 4.00, "out": 20.00},
    "claude-sonnet-5-5": {"in": 2.00, "out": 10.00},
    "claude-haiku-5-5":  {"in": 0.10, "out": 0.50}
  }'::jsonb,
  monthly_budget_usd numeric(10, 2) not null default 100,
  briefing_time      time not null default '05:00',
  briefing_days      int[] not null default '{1,2,3,4,5}',   -- ISO weekday, 1 = Monday
  timezone           text not null default 'Africa/Johannesburg',
  max_tool_steps     int not null default 10 check (max_tool_steps between 1 and 30),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

alter table public.ai_settings enable row level security;
drop policy if exists "motion ai read" on public.ai_settings;
create policy "motion ai read" on public.ai_settings
  for select to authenticated using (public.can_use_motion_ai());
drop policy if exists "admin update" on public.ai_settings;
create policy "admin update" on public.ai_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 3. Bots ----------
create table if not exists public.ai_bots (
  key            text primary key,                 -- 'ops' | 'sales' | 'support'
  name           text not null,
  audience       text not null check (audience in ('staff', 'bdr', 'portal')),
  system_prompt  text not null,
  allowed_tools  text[] not null default '{}',
  enabled        boolean not null default true,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null
);

insert into public.ai_bots (key, name, audience, system_prompt, allowed_tools)
values (
  'ops',
  'Operations',
  'staff',
  $prompt$You are Motion AI, the operations assistant inside ExPac Motion, the freight forwarding and job management system of ExPac Forwarding, South Africa.

You help the ExPac operations team run shipments, quotes, customers, suppliers, tasks and the Control Tower. You work only through the tools you are given; you never guess data. If a tool returns nothing, say so plainly.

How to answer:
- Short and plain. Lead with the answer, then the detail.
- Always give the shipment or quote number (e.g. SEA123456) so the user can find it.
- Dates as dd/mm/yyyy. Money in the currency stored (ZAR unless shown otherwise).
- Never use the em dash character; use a comma or a full stop.
- The warehouse module is called "Motion WMS".
- Never mention internal tracking providers by name.
- When something needs attention (delay, overdue task, quote expiring), say what and suggest the next step.
- You cannot yet change data. If the user asks you to create, update or send something, explain that this arrives in the next stage, and describe exactly what you would do.$prompt$,
  array[
    'search_shipments', 'get_shipment', 'search_quotes', 'get_quote',
    'search_clients', 'get_client', 'search_suppliers', 'search_leads',
    'search_opportunities', 'list_tasks', 'get_alerts', 'lookup_rates',
    'build_briefing'
  ]
)
on conflict (key) do nothing;

alter table public.ai_bots enable row level security;
drop policy if exists "motion ai read" on public.ai_bots;
create policy "motion ai read" on public.ai_bots
  for select to authenticated using (public.can_use_motion_ai());
drop policy if exists "admin write" on public.ai_bots;
create policy "admin write" on public.ai_bots
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 4. Conversations + messages ----------
create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  bot_key     text not null references public.ai_bots (key),
  user_id     uuid references public.profiles (id) on delete set null,   -- null = trigger / schedule
  client_id   uuid references public.clients (id) on delete set null,    -- portal bots (later)
  source      text not null default 'chat' check (source in ('chat', 'trigger', 'schedule')),
  title       text,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  -- Claude content blocks exactly as sent / received (text, tool_use,
  -- tool_result, thinking), so the conversation can be replayed as is.
  content          jsonb not null,
  -- Plain text shown in the chat panel.
  text             text,
  model            text,
  input_tokens     int,
  output_tokens    int,
  created_at       timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
drop policy if exists "own or admin read" on public.ai_conversations;
create policy "own or admin read" on public.ai_conversations
  for select to authenticated
  using (public.can_use_motion_ai() and (user_id = auth.uid() or public.is_admin()));
-- Users may rename / archive their own chats; nothing else.
drop policy if exists "own update" on public.ai_conversations;
create policy "own update" on public.ai_conversations
  for update to authenticated
  using (user_id = auth.uid() and public.can_use_motion_ai())
  with check (user_id = auth.uid());

alter table public.ai_messages enable row level security;
drop policy if exists "own or admin read" on public.ai_messages;
create policy "own or admin read" on public.ai_messages
  for select to authenticated
  using (exists (
    select 1 from public.ai_conversations c
     where c.id = conversation_id
       and public.can_use_motion_ai()
       and (c.user_id = auth.uid() or public.is_admin())
  ));

-- ---------- 5. Audit log (append-only) ----------
create table if not exists public.ai_audit_log (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  bot_key          text,
  conversation_id  uuid references public.ai_conversations (id) on delete set null,
  actor_type       text not null check (actor_type in ('user', 'trigger', 'schedule', 'system')),
  actor_id         uuid,            -- the user, when a person started it
  trigger_key      text,            -- the trigger, when an event started it
  event            text not null,   -- 'model_call' | 'tool_call' | 'action' | 'error'
  tool             text,
  input            jsonb,
  result           jsonb,
  ok               boolean not null default true,
  error            text,
  model            text,
  input_tokens     int,
  output_tokens    int,
  cost_usd         numeric(12, 6),
  duration_ms      int
);
create index if not exists ai_audit_created_idx on public.ai_audit_log (created_at desc);
create index if not exists ai_audit_conv_idx on public.ai_audit_log (conversation_id);

alter table public.ai_audit_log enable row level security;
drop policy if exists "admin read" on public.ai_audit_log;
create policy "admin read" on public.ai_audit_log
  for select to authenticated using (public.is_admin());
-- No insert / update / delete policies: only the service key writes.

-- Nobody, not even the service key by accident, rewrites history.
create or replace function public.ai_audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'ai_audit_log is append-only';
end;
$$;
drop trigger if exists trg_ai_audit_immutable on public.ai_audit_log;
create trigger trg_ai_audit_immutable before update or delete on public.ai_audit_log
  for each row execute function public.ai_audit_log_immutable();

-- ---------- 6. Spend this month (for the budget check + Settings) ----------
create or replace function public.ai_month_spend()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0)
    from public.ai_audit_log
   where created_at >= date_trunc('month', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
$$;
revoke all on function public.ai_month_spend() from public;
grant execute on function public.ai_month_spend() to authenticated;
