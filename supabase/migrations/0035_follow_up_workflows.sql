-- ============================================================
-- 0035  Sales CRM Phase 5: Automated follow-up workflows
-- ============================================================
-- Rules like "if a Sent quote goes quiet for 3 days, email template X".
-- A pg_cron job runs process_due_follow_ups() hourly; it finds due
-- subjects, records each in follow_up_log (unique per rule+subject so it
-- never double-sends), and dispatches the mail via pg_net to the existing
-- /api/send-mail Cloudflare function (authenticated with a shared secret
-- instead of a user JWT).
--
-- Run in the Supabase SQL editor after 0034. Self-contained & idempotent.
--
-- ONE-TIME SETUP after running this (see bottom of file):
--   1. enable pg_cron + pg_net in Supabase dashboard -> Database -> Extensions
--      (do this FIRST if you haven't; the DO blocks below just warn if missing)
--   2. update private.follow_up_config with your site URL + a random secret
--   3. set CRON_SECRET to the same value in the Cloudflare Pages env

-- Best-effort: the tables + worker below still install if these aren't ready.
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not enabled yet — enable it in the dashboard, then re-run the tail of this file';
end $$;

create schema if not exists private;

create table if not exists private.follow_up_config (
  id          int primary key default 1 check (id = 1),
  site_url    text not null default '',
  cron_secret text not null default ''
);
insert into private.follow_up_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.follow_up_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  trigger     text not null check (trigger in
                ('quote_quiet', 'lead_no_quote', 'campaign_no_open', 'shipment_delivered')),
  delay_days  int not null default 3 check (delay_days >= 0),
  template_id uuid references public.mail_templates (id) on delete set null,
  active      boolean not null default true,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.follow_up_log (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid references public.follow_up_rules (id) on delete cascade,
  trigger     text not null,
  subject_key text not null,
  lead_id     uuid references public.leads (id) on delete set null,
  email       text not null,
  subject     text,
  status      text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error       text,
  created_at  timestamptz not null default now(),
  unique (rule_id, subject_key)
);
create index if not exists follow_up_log_created_idx on public.follow_up_log (created_at desc);

alter table public.follow_up_rules enable row level security;
drop policy if exists "team full access" on public.follow_up_rules;
create policy "team full access" on public.follow_up_rules
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.follow_up_log enable row level security;
drop policy if exists "team full access" on public.follow_up_log;
create policy "team full access" on public.follow_up_log
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Unsubscribe now also resolves a follow_up_log id (campaign recipients
-- were the only source before).
create or replace function public.unsubscribe_lead(p_recipient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  select lead_id into v_lead_id
  from public.mail_campaign_recipients
  where id = p_recipient_id;

  if v_lead_id is null then
    select lead_id into v_lead_id
    from public.follow_up_log
    where id = p_recipient_id;
  end if;

  if v_lead_id is null then
    return false;
  end if;

  update public.leads set unsubscribed_at = now() where id = v_lead_id;
  return true;
end;
$$;

-- ------------------------------------------------------------
-- The worker. Returns how many follow-ups it dispatched.
-- ------------------------------------------------------------
create or replace function public.process_due_follow_ups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg      private.follow_up_config%rowtype;
  v_rule     public.follow_up_rules%rowtype;
  v_tpl_subj text;
  v_tpl_body text;
  v_row      record;
  v_limit    int := 50;
  v_count    int := 0;
  v_log_id   uuid;
  v_unsub    text;
  v_subject  text;
  v_html     text;
  v_text     text;
begin
  -- Staff may call this by hand ("Run now"); cron calls it with no JWT.
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'not authorized';
  end if;

  select * into v_cfg from private.follow_up_config where id = 1;
  if v_cfg.site_url is null or v_cfg.site_url = '' then
    return 0;  -- not configured yet
  end if;

  for v_rule in
    select * from public.follow_up_rules where active and template_id is not null
  loop
    select subject, body into v_tpl_subj, v_tpl_body
    from public.mail_templates where id = v_rule.template_id;
    if v_tpl_subj is null then
      continue;
    end if;

    for v_row in
      select *
      from (
        -- quote gone quiet: still 'sent' N days after last touch
        select q.id::text as skey, null::uuid as lead_id, c.email as email,
               coalesce(c.contact, c.company) as nm, c.company as co
        from public.quotes q
        join public.clients c on c.id = q.client_id
        where v_rule.trigger = 'quote_quiet'
          and q.status = 'sent'
          and q.updated_at <= now() - make_interval(days => v_rule.delay_days)
          and coalesce(c.email, '') <> ''

        union all
        -- new lead with no quote raised yet
        select l.id::text, l.id, l.email,
               coalesce(l.contact, l.company), l.company
        from public.leads l
        where v_rule.trigger = 'lead_no_quote'
          and l.promoted_client_id is null
          and l.unsubscribed_at is null
          and coalesce(l.email, '') <> ''
          and l.created_at <= now() - make_interval(days => v_rule.delay_days)
          and not exists (select 1 from public.quotes q where q.lead_id = l.id)

        union all
        -- campaign recipient that never opened
        select r.id::text, r.lead_id, r.email,
               coalesce(ld.contact, ld.company, ''), coalesce(ld.company, '')
        from public.mail_campaign_recipients r
        left join public.leads ld on ld.id = r.lead_id
        where v_rule.trigger = 'campaign_no_open'
          and r.status in ('sent', 'delivered')
          and r.sent_at is not null
          and r.sent_at <= now() - make_interval(days => v_rule.delay_days)
          and (ld.id is null or ld.unsubscribed_at is null)

        union all
        -- shipment delivered N days ago (delivered-at = first Delivered event)
        select j.id::text, null::uuid, c.email,
               coalesce(c.contact, c.company), c.company
        from public.jobs j
        join public.clients c on c.id = j.client_id
        where v_rule.trigger = 'shipment_delivered'
          and j.milestone = 'Delivered'
          and coalesce(c.email, '') <> ''
          and (
            select min(je.created_at) from public.job_events je
            where je.job_id = j.id and je.milestone = 'Delivered'
          ) <= now() - make_interval(days => v_rule.delay_days)
      ) cand
      where not exists (
        select 1 from public.follow_up_log lg
        where lg.rule_id = v_rule.id and lg.subject_key = cand.skey
      )
      limit v_limit
    loop
      begin
        insert into public.follow_up_log (rule_id, trigger, subject_key, lead_id, email)
        values (v_rule.id, v_rule.trigger, v_row.skey, v_row.lead_id, v_row.email)
        returning id into v_log_id;
      exception when unique_violation then
        continue;  -- a concurrent run already took this one
      end;

      v_unsub := v_cfg.site_url || '/unsubscribe?r=' || v_log_id;
      v_subject := replace(replace(replace(coalesce(v_tpl_subj, ''),
        '{{ contact.name }}', coalesce(v_row.nm, '')),
        '{{ contact.company }}', coalesce(v_row.co, '')),
        '{{ unsubscribe_link }}', v_unsub);
      v_html := replace(replace(replace(coalesce(v_tpl_body, ''),
        '{{ contact.name }}', coalesce(v_row.nm, '')),
        '{{ contact.company }}', coalesce(v_row.co, '')),
        '{{ unsubscribe_link }}', v_unsub);
      v_text := btrim(regexp_replace(regexp_replace(v_html, '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'));

      update public.follow_up_log set subject = v_subject where id = v_log_id;

      perform net.http_post(
        url := v_cfg.site_url || '/api/send-mail',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-key', v_cfg.cron_secret
        ),
        body := jsonb_build_object(
          'to', jsonb_build_array(v_row.email),
          'subject', v_subject,
          'html', v_html,
          'text', v_text
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.process_due_follow_ups() to authenticated;

-- hourly cron -- best-effort; skipped with a notice if pg_cron isn't enabled.
-- Re-run just this block after enabling pg_cron in the dashboard.
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled — enable it in the dashboard, then re-run this DO block';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'process-follow-ups') then
    perform cron.unschedule('process-follow-ups');
  end if;
  perform cron.schedule(
    'process-follow-ups',
    '17 * * * *',
    'select public.process_due_follow_ups();'
  );
end $$;

-- ============================================================
-- ONE-TIME SETUP -- edit and run this separately once:
--
--   update private.follow_up_config
--   set site_url    = 'https://expac-motion.pages.dev',
--       cron_secret = 'PASTE-A-LONG-RANDOM-STRING-HERE';
--
-- Then set CRON_SECRET to that same string in the Cloudflare Pages env.
-- ============================================================
