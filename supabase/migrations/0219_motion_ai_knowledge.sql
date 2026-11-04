-- ============================================================
-- 0219  Motion AI, stage 5: knowledge base and learning loop
-- ============================================================
-- * ai_knowledge: what the bots read before answering: SOPs, pricing
--   rules, the tone guide, approved examples and learned corrections.
--   Active entries matching the request are added to each bot turn
--   (full-text search, no extra service). Admins manage it in
--   Settings > Motion AI knowledge.
-- * ai_feedback: every Approve / Edit / Reject / Undo of an AI action and
--   every thumbs up / down on an answer.
-- * Learning: an edit before approving, a rejection with a reason, or a
--   thumbs down with a note becomes a "learned" entry, PENDING until an
--   admin approves it. Only then do the bots use it.
--
-- Run in the Supabase SQL editor after 0218. Self-contained & idempotent.

-- ---------- 1. Knowledge ----------
-- The search text of an entry. Wrapped as immutable because a generated
-- column may only use immutable functions (array_to_string is "stable").
create or replace function public.ai_kb_tsv(p_title text, p_tags text[], p_body text)
returns tsvector language sql immutable as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'A') ||
         setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(p_tags, ' '), '')), 'A') ||
         setweight(to_tsvector('english'::regconfig, coalesce(p_body, '')), 'B')
$$;

create table if not exists public.ai_knowledge (
  id               uuid primary key default gen_random_uuid(),
  scope            text not null default 'all' check (scope in ('all', 'ops', 'sales', 'support')),
  kind             text not null check (kind in ('sop', 'pricing_rule', 'tone', 'example', 'correction')),
  title            text not null,
  body             text not null,
  tags             text[] not null default '{}',
  status           text not null default 'active' check (status in ('active', 'pending', 'archived')),
  source           text not null default 'manual' check (source in ('manual', 'learned')),
  source_action_id uuid references public.ai_actions (id) on delete set null,
  source_note      text,               -- why it was learned (who changed what)
  use_count        int not null default 0,
  last_used_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  fts              tsvector generated always as (public.ai_kb_tsv(title, tags, body)) stored
);
create index if not exists ai_knowledge_fts_idx on public.ai_knowledge using gin (fts);
create index if not exists ai_knowledge_status_idx on public.ai_knowledge (status, kind);

alter table public.ai_knowledge enable row level security;
drop policy if exists "motion ai read" on public.ai_knowledge;
create policy "motion ai read" on public.ai_knowledge
  for select to authenticated using (public.can_use_motion_ai());
drop policy if exists "admin write" on public.ai_knowledge;
create policy "admin write" on public.ai_knowledge
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Starter tone guide (edit it in Settings > Motion AI knowledge).
insert into public.ai_knowledge (scope, kind, title, body, tags)
select 'all', 'tone', 'ExPac tone of voice',
$t$- Warm, short and professional; plain South African business English.
- Lead with what the customer needs to know, then the detail.
- Always give the shipment or quote number.
- Dates as dd/mm/yyyy. Money with its currency (R for rand).
- Never use the em dash character; use a comma or a full stop.
- Greeting: "Good day [first name]," Sign-off: "Kind regards" (the signature is added automatically).
- No jargon the customer would not use; explain any freight term in a few words.
- Never promise dates or prices that are not confirmed.$t$,
'{tone,email,style}'
where not exists (select 1 from public.ai_knowledge where kind = 'tone' and title = 'ExPac tone of voice');

-- ---------- 2. Feedback ----------
create table if not exists public.ai_feedback (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  user_id          uuid references public.profiles (id) on delete set null,
  bot_key          text,
  action_id        uuid references public.ai_actions (id) on delete set null,
  message_id       uuid references public.ai_messages (id) on delete set null,
  kind             text not null check (kind in ('approve', 'edit', 'reject', 'undo', 'thumbs_up', 'thumbs_down')),
  original         jsonb,
  edited           jsonb,
  note             text,
  knowledge_id     uuid references public.ai_knowledge (id) on delete set null
);
create index if not exists ai_feedback_created_idx on public.ai_feedback (created_at desc);
create index if not exists ai_feedback_message_idx on public.ai_feedback (message_id);

alter table public.ai_feedback enable row level security;
drop policy if exists "admin read" on public.ai_feedback;
create policy "admin read" on public.ai_feedback
  for select to authenticated using (public.is_admin());
-- Users see their own ratings (so the panel can show them).
drop policy if exists "own read" on public.ai_feedback;
create policy "own read" on public.ai_feedback
  for select to authenticated using (user_id = auth.uid());

-- ---------- 3. Search (used by the bots, service key) ----------
create or replace function public.ai_search_knowledge(p_bot text, p_query text, p_limit int default 5)
returns table (id uuid, kind text, title text, body text, rank real)
language sql stable security definer set search_path = public as $$
  with q as (
    -- OR the words together so a long question still finds partial matches.
    select to_tsquery('simple', string_agg(quote_literal(w), ' | ')) as tsq
      from (
        select distinct lexeme as w
          from unnest(to_tsvector('english', coalesce(p_query, ''))) as t
         limit 40
      ) words
  )
  select k.id, k.kind, k.title, k.body, ts_rank(k.fts, q.tsq) as rank
    from public.ai_knowledge k, q
   where (auth.role() = 'service_role' or public.can_use_motion_ai())
     and k.status = 'active'
     and k.scope in ('all', p_bot)
     and k.kind <> 'tone'
     and q.tsq is not null
     and k.fts @@ q.tsq
   order by rank desc, k.updated_at desc
   limit greatest(1, least(p_limit, 10));
$$;
revoke all on function public.ai_search_knowledge(text, text, int) from public, anon;
grant execute on function public.ai_search_knowledge(text, text, int) to authenticated, service_role;

create or replace function public.ai_mark_knowledge_used(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.ai_knowledge set use_count = use_count + 1, last_used_at = now() where id = any (p_ids);
$$;
revoke all on function public.ai_mark_knowledge_used(uuid[]) from public, anon, authenticated;
grant execute on function public.ai_mark_knowledge_used(uuid[]) to service_role;

-- ---------- 4. Thumbs up / down on an answer ----------
create or replace function public.ai_rate_message(p_message_id uuid, p_rating text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  m        public.ai_messages%rowtype;
  c        public.ai_conversations%rowtype;
  v_q      text;
  v_kid    uuid;
begin
  if not public.can_use_motion_ai() then
    raise exception 'No Motion AI access.';
  end if;
  if p_rating not in ('thumbs_up', 'thumbs_down') then
    raise exception 'Rating must be thumbs_up or thumbs_down.';
  end if;
  select * into m from public.ai_messages where id = p_message_id and role = 'assistant';
  if not found then
    raise exception 'Answer not found.';
  end if;
  select * into c from public.ai_conversations where id = m.conversation_id;
  if c.user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Not your conversation.';
  end if;
  -- One rating per person per answer: the latest wins.
  delete from public.ai_feedback where message_id = p_message_id and user_id = auth.uid();

  if p_rating = 'thumbs_down' and nullif(btrim(coalesce(p_note, '')), '') is not null then
    select text into v_q from public.ai_messages
     where conversation_id = m.conversation_id and role = 'user' and text is not null and created_at < m.created_at
     order by created_at desc limit 1;
    insert into public.ai_knowledge (scope, kind, title, body, status, source, source_note, created_by)
    values (c.bot_key, 'correction',
            'Correction: ' || left(coalesce(v_q, 'an answer'), 80),
            'When asked: "' || left(coalesce(v_q, ''), 400) || E'"\nThe answer was not right. What the team said: ' || btrim(p_note),
            'pending', 'learned', 'Thumbs down on an answer', auth.uid())
    returning id into v_kid;
  end if;

  insert into public.ai_feedback (user_id, bot_key, message_id, kind, original, note, knowledge_id)
  values (auth.uid(), c.bot_key, p_message_id, p_rating, jsonb_build_object('text', left(m.text, 4000)),
          nullif(btrim(coalesce(p_note, '')), ''), v_kid);
end;
$$;
revoke all on function public.ai_rate_message(uuid, text, text) from public, anon;
grant execute on function public.ai_rate_message(uuid, text, text) to authenticated;

-- ---------- 5. Bot: can search the knowledge base itself ----------
update public.ai_bots
   set allowed_tools = (
         select array_agg(distinct t order by t)
           from unnest(allowed_tools || array['search_knowledge']) as t
       ),
       system_prompt = system_prompt || $rules$

Company knowledge:
- Relevant ExPac knowledge (SOPs, pricing rules, approved examples, corrections) is added to each request under "Company knowledge". Follow it; it overrides your general habits. Corrections come from the team's own edits, so treat them as instructions.
- If you need a procedure or rule that was not included, use search_knowledge before guessing.$rules$,
       updated_at = now()
 where key = 'ops'
   and position('Company knowledge:' in system_prompt) = 0;

-- ---------- 6. Live updates ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_knowledge') then
    alter publication supabase_realtime add table public.ai_knowledge;
  end if;
end;
$$;
