-- ============================================================
-- 0218  Motion AI, stage 4: triggers, schedules, daily briefing
-- ============================================================
-- Bots now also run without anyone typing:
--   * database triggers put an event in public.ai_events when something
--     happens (new lead, new enquiry, important shipment status change);
--   * public.ai_scan() (every 5 min) adds time-based events: quote
--     follow-up due, ETA passed without arrival, overdue-task digest and
--     the daily briefing (Settings > Motion AI: 05:00, Mon-Fri);
--   * every minute, when events are waiting, pg_cron calls the
--     motion-ai-worker Edge Function, which runs the bot for each event.
--     Its output lands as approval cards and as a conversation ("Daily
--     briefing 05/11/2026") in the Motion AI panel and Control Tower.
--   * Failures retry 3 times; a stuck queue or failing worker shows in
--     System health and sends the usual alert email.
--
-- Changes Motion AI makes itself never fire these triggers (no loops).
--
-- Run in the Supabase SQL editor after 0217. Self-contained & idempotent.

-- ---------- 1. Trigger catalogue ----------
create table if not exists public.ai_triggers (
  key          text primary key,
  label        text not null,
  kind         text not null check (kind in ('event', 'schedule')),
  bot_key      text not null references public.ai_bots (key),
  -- Which ai_settings.models entry: trigger (quick checks) / briefing / deep.
  task         text not null default 'trigger',
  instruction  text not null,
  enabled      boolean not null default true,
  sort         int not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);

insert into public.ai_triggers (key, label, kind, bot_key, task, sort, instruction) values
  ('daily_briefing', 'Daily briefing', 'schedule', 'ops', 'briefing', 1,
   $i$Prepare today's operations briefing for the ExPac team. Call build_briefing first.
Lay it out as: one headline line; Needs attention now; Arrivals and delays; Tasks (overdue, due today); Quotes (follow up, expiring); New leads and enquiries; System (only if something is failing).
Short bullets, shipment and quote numbers on every line, counts where useful. Skip empty sections.
Only create approval cards for something urgent (for example a Detained shipment with no open task); otherwise just report.$i$),
  ('new_lead', 'New lead', 'event', 'ops', 'trigger', 2,
   $i$A new Sales CRM lead was just added (details below). Look the lead up with search_leads.
If it has enough to act on, create ONE task for the team to make first contact within 1 working day (create_task, priority normal, title naming the company). If it looks like spam or a duplicate of an existing customer, create no task and say why in one line.$i$),
  ('new_enquiry', 'New website or portal enquiry', 'event', 'ops', 'trigger', 3,
   $i$A new enquiry just came in from the website or the customer portal (details below). Read it.
If the customer, mode, origin, destination and packing list are all known, propose a quote with draft_quote. If something is missing, create ONE task to get the missing details (list them in the task) and draft a short, friendly email to the customer asking for them (draft_email). Never invent details.$i$),
  ('status_change', 'Shipment status change', 'event', 'ops', 'trigger', 4,
   $i$A shipment's status just changed (details below). Look it up with get_shipment, then decide whether anything needs doing:
- Arrived: if there is no open task about clearing or delivery, create one (due today).
- Customs or Detained: if there is no open task about it, create a high-priority task to follow up.
- Released: if delivery is not yet arranged, create a task to book delivery.
- Delivered: draft a short email telling the customer it was delivered (draft_email), and if it is not invoiced yet create a task to invoice.
If nothing is needed, create nothing and say so in one line.$i$),
  ('quote_follow_up', 'Quote follow-up due', 'event', 'ops', 'trigger', 5,
   $i$This quotation was sent a few days ago and has had no answer (details below). Look it up with get_quote.
Draft ONE short, friendly follow-up email to the customer (draft_email, linked to the quote): ask if they had a chance to review it, offer to adjust anything, mention the validity date if it is close. Do not repeat prices.$i$),
  ('eta_overdue', 'ETA passed, not arrived', 'event', 'ops', 'trigger', 6,
   $i$This shipment's ETA has passed but it is not marked Arrived (details below). Look it up with get_shipment, including live tracking.
If tracking shows it arrived, propose the status update to Arrived (update_shipment_status). Otherwise, if there is no open task about it, create a task to check the new ETA with the carrier or agent. Create nothing if it is already being handled.$i$),
  ('tasks_overdue', 'Overdue tasks digest', 'schedule', 'ops', 'trigger', 7,
   $i$Give a short digest of overdue Control Tower tasks: call list_tasks with filter overdue. Group them by who they are assigned to, oldest first, and suggest which two or three to tackle first. Do not create tasks.$i$)
on conflict (key) do nothing;

alter table public.ai_triggers enable row level security;
drop policy if exists "motion ai read" on public.ai_triggers;
create policy "motion ai read" on public.ai_triggers
  for select to authenticated using (public.can_use_motion_ai());
drop policy if exists "admin update" on public.ai_triggers;
create policy "admin update" on public.ai_triggers
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 2. Event queue ----------
create table if not exists public.ai_events (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  trigger_key      text not null references public.ai_triggers (key) on delete cascade,
  payload          jsonb not null default '{}',
  -- One event per thing (e.g. a quote's follow-up once a week).
  dedupe_key       text not null unique,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts         int not null default 0,
  run_after        timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  conversation_id  uuid references public.ai_conversations (id) on delete set null,
  summary          text,
  error            text
);
create index if not exists ai_events_queue_idx on public.ai_events (status, run_after);
create index if not exists ai_events_created_idx on public.ai_events (created_at desc);

alter table public.ai_events enable row level security;
drop policy if exists "motion ai read" on public.ai_events;
create policy "motion ai read" on public.ai_events
  for select to authenticated using (public.can_use_motion_ai());

alter table public.ai_conversations add column if not exists trigger_key text;

/** Queue an event, if Motion AI and that trigger are switched on. Never
 *  raises: a hiccup here must not stop the save that fired it. */
create or replace function public.ai_enqueue(p_trigger text, p_payload jsonb, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if current_setting('motion_ai.acting', true) = 'on' then
    return;   -- Motion AI's own change
  end if;
  if not exists (select 1 from public.ai_settings where id = 1 and enabled)
     or not exists (select 1 from public.ai_triggers where key = p_trigger and enabled) then
    return;
  end if;
  insert into public.ai_events (trigger_key, payload, dedupe_key)
  values (p_trigger, coalesce(p_payload, '{}'), p_dedupe)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning 'ai_enqueue(%) failed: %', p_trigger, sqlerrm;
end;
$$;
revoke all on function public.ai_enqueue(text, jsonb, text) from public, anon, authenticated;

-- Motion AI's own status changes don't re-trigger it.
create or replace function public.ai_set_shipment_status(p_job uuid, p_status text, p_note text default null)
returns text language plpgsql security invoker set search_path = public as $$
declare
  st text := btrim(coalesce(p_status, ''));
  ms text;
begin
  if st = '' then
    raise exception 'A status is required.';
  end if;
  perform set_config('motion_ai.acting', 'on', true);
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

-- ---------- 3. Event triggers ----------
create or replace function public.ai_on_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_enqueue('new_lead',
    jsonb_build_object('lead_id', new.id, 'company', new.company, 'contact', new.contact,
                       'email', new.email, 'source', new.source, 'notes', left(coalesce(new.notes, ''), 1000)),
    'lead:' || new.id);
  return null;
end;
$$;
drop trigger if exists trg_ai_on_lead on public.leads;
create trigger trg_ai_on_lead after insert on public.leads
  for each row execute function public.ai_on_lead();

create or replace function public.ai_on_form()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ai_enqueue('new_enquiry',
    jsonb_build_object('source', 'website form', 'submission_id', new.id, 'lead_id', new.lead_id,
                       'answers', new.data),
    'form:' || new.id);
  return null;
end;
$$;
drop trigger if exists trg_ai_on_form on public.web_form_submissions;
create trigger trg_ai_on_form after insert on public.web_form_submissions
  for each row execute function public.ai_on_form();

create or replace function public.ai_on_quote_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.portal_requested_at is not null or new.enquiry_notes is not null then
    perform public.ai_enqueue('new_enquiry',
      jsonb_build_object('source', case when new.portal_requested_at is not null then 'customer portal' else 'website quote request' end,
                         'quote_id', new.id, 'reference', new.reference, 'mode', new.mode,
                         'origin', new.origin, 'destination', new.destination,
                         'notes', left(coalesce(new.request_notes, new.enquiry_notes, ''), 1500)),
      'quote-request:' || new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ai_on_quote_request on public.quotes;
create trigger trg_ai_on_quote_request after insert on public.quotes
  for each row execute function public.ai_on_quote_request();

create or replace function public.ai_on_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shipment_status in ('Arrived', 'Customs', 'Detained', 'Released', 'Delivered')
     and new.shipment_status is distinct from old.shipment_status then
    perform public.ai_enqueue('status_change',
      jsonb_build_object('job_id', new.id, 'reference', new.reference,
                         'from', old.shipment_status, 'to', new.shipment_status),
      'status:' || new.id || ':' || new.shipment_status || ':' || to_char(now(), 'YYYYMMDD'));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ai_on_status on public.jobs;
create trigger trg_ai_on_status after update of shipment_status on public.jobs
  for each row execute function public.ai_on_status();

-- ---------- 4. Time-based scan (every 5 minutes) ----------
create or replace function public.ai_scan()
returns void language plpgsql security definer set search_path = public as $$
declare
  s        public.ai_settings%rowtype;
  v_now    timestamp := now() at time zone 'Africa/Johannesburg';
  v_today  date := (now() at time zone 'Africa/Johannesburg')::date;
  v_week   text := to_char(now() at time zone 'Africa/Johannesburg', 'IYYY-IW');
  r        record;
begin
  select * into s from public.ai_settings where id = 1;
  if not found or not s.enabled then
    return;
  end if;

  -- Events stuck in "running" (worker died) go back in the queue.
  update public.ai_events set status = 'queued', run_after = now()
   where status = 'running' and started_at < now() - interval '10 minutes';

  -- Daily briefing at the set time on the set days.
  if extract(isodow from v_now)::int = any (s.briefing_days) and v_now::time >= s.briefing_time then
    perform public.ai_enqueue('daily_briefing', jsonb_build_object('date', v_today), 'briefing:' || v_today);
  end if;

  -- Overdue-task digest, weekdays from 10:00.
  if extract(isodow from v_now)::int between 1 and 5 and v_now::time >= time '10:00'
     and exists (select 1 from public.ops_tasks where status <> 'done' and due_date < v_today) then
    perform public.ai_enqueue('tasks_overdue', jsonb_build_object('date', v_today), 'overdue:' || v_today);
  end if;

  -- Quote follow-ups: sent 3 to 14 days ago, still no answer; once a week
  -- per quote, at most 10 new per scan, working hours only.
  if extract(isodow from v_now)::int between 1 and 5 and v_now::time between time '07:00' and time '16:00' then
    for r in
      select q.id, q.reference, q.sent_at, q.valid_until
        from public.quotes q
       where q.status = 'sent'
         and q.sent_at between now() - interval '14 days' and now() - interval '3 days'
         and not exists (select 1 from public.ai_events e where e.dedupe_key = 'quote-fu:' || q.id || ':' || v_week)
       order by q.sent_at
       limit 10
    loop
      perform public.ai_enqueue('quote_follow_up',
        jsonb_build_object('quote_id', r.id, 'reference', r.reference, 'sent_at', r.sent_at, 'valid_until', r.valid_until),
        'quote-fu:' || r.id || ':' || v_week);
    end loop;

    -- ETA passed (up to 14 days ago), not arrived, still active; once a day.
    for r in
      select j.id, j.reference, j.eta, j.shipment_status
        from public.jobs j
       where j.ops_completed_at is null
         and j.eta < v_today and j.eta >= v_today - 14
         and coalesce(j.shipment_status, '') not in ('Arrived', 'Unloaded', 'Customs', 'Detained', 'Released', 'On-Delivery', 'Delivered')
         and not exists (select 1 from public.ai_events e where e.dedupe_key = 'eta:' || j.id || ':' || v_today)
       order by j.eta
       limit 10
    loop
      perform public.ai_enqueue('eta_overdue',
        jsonb_build_object('job_id', r.id, 'reference', r.reference, 'eta', r.eta, 'status', r.shipment_status),
        'eta:' || r.id || ':' || v_today);
    end loop;
  end if;
end;
$$;
revoke all on function public.ai_scan() from public, anon, authenticated;

-- ---------- 5. Worker plumbing ----------
/** The worker proves it was called by our cron (same key as the site's jobs). */
create or replace function public.ai_check_worker_key(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_key, '') <> '' and exists (
    select 1 from private.follow_up_config where id = 1 and cron_secret = p_key
  );
$$;
revoke all on function public.ai_check_worker_key(text) from public, anon, authenticated;
grant execute on function public.ai_check_worker_key(text) to service_role;

/** Hands the worker up to p_limit waiting events, safely in parallel. */
create or replace function public.ai_claim_events(p_limit int default 5)
returns setof public.ai_events language sql security definer set search_path = public as $$
  update public.ai_events e
     set status = 'running', attempts = e.attempts + 1, started_at = now()
   where e.id in (
     select id from public.ai_events
      where status = 'queued' and run_after <= now()
      order by (trigger_key = 'daily_briefing') desc, created_at
      limit greatest(1, least(p_limit, 20))
      for update skip locked
   )
  returning e.*;
$$;
revoke all on function public.ai_claim_events(int) from public, anon, authenticated;
grant execute on function public.ai_claim_events(int) to service_role;

/** Calls the worker only when something is waiting (saves invocations). */
create or replace function private.call_ai_worker()
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  c   private.follow_up_config%rowtype;
  req bigint;
begin
  if not exists (select 1 from public.ai_events where status = 'queued' and run_after <= now()) then
    return null;
  end if;
  select * into c from private.follow_up_config where id = 1;
  if coalesce(c.cron_secret, '') = '' then
    return null;
  end if;
  req := net.http_post(
    url := 'https://fdzwnvinqiqrexhzgqkp.supabase.co/functions/v1/motion-ai-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  insert into private.job_calls (request_id, job) values (req, 'motion-ai-worker') on conflict do nothing;
  return req;
end;
$$;
revoke all on function private.call_ai_worker() from public;

-- ---------- 6. Health ----------
create or replace function public.ai_health_check()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stuck  int;
  v_failed int;
  v_status int;
  v_body   text;
  v_ok     boolean;
  v_detail text;
  v_line   text;
begin
  if not exists (select 1 from public.ai_settings where id = 1 and enabled) then
    return;
  end if;
  select count(*) into v_stuck from public.ai_events
   where status = 'queued' and run_after < now() - interval '15 minutes';
  select count(*) into v_failed from public.ai_events
   where status = 'failed' and finished_at > now() - interval '1 hour';
  select h.status_code, left(h.content::text, 200) into v_status, v_body
    from private.job_calls c join net._http_response h on h.id = c.request_id
   where c.job = 'motion-ai-worker'
   order by c.called_at desc limit 1;
  v_ok := v_stuck = 0 and v_failed < 3 and (v_status is null or v_status between 200 and 299);
  v_detail := case
    when v_status is not null and v_status not between 200 and 299 then 'Worker replied ' || v_status || coalesce(': ' || v_body, '')
    when v_stuck > 0 then v_stuck || ' event(s) waiting over 15 minutes'
    when v_failed >= 3 then v_failed || ' event(s) failed in the last hour'
    else null
  end;
  v_line := private.health_set('motion-ai', 'Motion AI (triggers and briefing)', 6, v_ok, v_detail,
                               case when v_ok then now() else null end);
  if v_line is not null then
    perform private.health_alert(array[v_line]);
  end if;
end;
$$;
revoke all on function public.ai_health_check() from public, anon, authenticated;

-- ---------- 7. Live updates + schedules ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_events') then
    alter publication supabase_realtime add table public.ai_events;
  end if;
end;
$$;

do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, Motion AI triggers will queue but not run';
    return;
  end if;
  perform cron.unschedule(jobname) from cron.job where jobname in ('motion-ai-scan', 'motion-ai-worker', 'motion-ai-health');
  perform cron.schedule('motion-ai-scan', '*/5 * * * *', 'select public.ai_scan()');
  perform cron.schedule('motion-ai-worker', '* * * * *', 'select private.call_ai_worker()');
  perform cron.schedule('motion-ai-health', '3-59/5 * * * *', 'select public.ai_health_check()');
end $$;

notify pgrst, 'reload schema';
