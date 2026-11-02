-- ============================================================
-- 0207  System health: know when background jobs or emails stop
-- ============================================================
-- On 2026-11-02 every background job had been failing silently (cron key
-- rejected, then Cloudflare's processing limit): no inbox sync, no vessel
-- positions, no website-form notification emails, and nobody knew.
--
--   1. private.job_calls  — each scheduled call to the site is recorded
--      with its pg_net request id, so its reply (net._http_response) can be
--      read back per job. The four direct jobs are rescheduled through
--      private.call_job() to do that.
--   2. public.system_health (+ _log) — one row per check: OK / failing,
--      why, since when, last success. Admins only. Motion shows a banner
--      and Settings › System health from it.
--   3. system_health_check() — every 5 minutes:
--        inbox-sync / vessel-sync / tracking-register / sage-sync: failing
--          when no successful reply inside the job's window;
--        email notifications: /api/send-mail is the only other caller
--          (website forms, follow-ups, campaigns), so any untracked reply
--          that was rejected / errored in the last 30 minutes.
--   4. Email alert on every change (failing / recovered), sent straight
--      to Resend from the database, so it still arrives when the site or
--      the cron key is the problem. Needs the Resend key in the vault:
--        select vault.create_secret('re_...', 'resend_api_key');
--      Without it the banner still works, there's just no email.
--
-- Run in the Supabase SQL editor after 0206. Self-contained & idempotent.

-- ---------- 1. Scheduled calls, by job ----------
create table if not exists private.job_calls (
  request_id bigint primary key,
  job        text not null,
  called_at  timestamptz not null default now()
);
create index if not exists job_calls_job_idx on private.job_calls (job, called_at desc);

-- Who gets the alert emails.
alter table private.follow_up_config
  add column if not exists alert_email text not null default 'support@expac.co.za';

create or replace function private.call_job(p_job text, p_path text, p_timeout int default 55000)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  c   private.follow_up_config%rowtype;
  req bigint;
begin
  select * into c from private.follow_up_config where id = 1;
  if coalesce(c.site_url, '') = '' or coalesce(c.cron_secret, '') = '' then
    return null;
  end if;
  req := net.http_post(
    url := c.site_url || p_path,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := p_timeout
  );
  insert into private.job_calls (request_id, job) values (req, p_job) on conflict do nothing;
  return req;
end;
$$;
revoke all on function private.call_job(text, text, int) from public;

-- ---------- 2. Health state ----------
create table if not exists public.system_health (
  check_key     text primary key,
  label         text not null,
  sort          int not null default 0,
  ok            boolean not null default true,
  detail        text,
  failing_since timestamptz,
  last_ok_at    timestamptz,
  checked_at    timestamptz not null default now()
);
alter table public.system_health enable row level security;
drop policy if exists "admins read" on public.system_health;
create policy "admins read" on public.system_health
  for select to authenticated using (public.is_admin());

create table if not exists public.system_health_log (
  id        bigserial primary key,
  check_key text not null,
  label     text not null,
  ok        boolean not null,
  detail    text,
  at        timestamptz not null default now()
);
create index if not exists system_health_log_at_idx on public.system_health_log (at desc);
alter table public.system_health_log enable row level security;
drop policy if exists "admins read" on public.system_health_log;
create policy "admins read" on public.system_health_log
  for select to authenticated using (public.is_admin());

-- ---------- 3. The checks ----------
/** A reply in plain words. */
create or replace function private.health_reason(p_status int, p_timed_out boolean, p_error text, p_body text)
returns text language sql immutable as $$
  select case
    when p_timed_out then 'Timed out, the site did not answer in time'
    when p_status is null and p_error is not null then 'Could not reach the site: ' || left(p_error, 160)
    when p_status is null then 'No reply from the site'
    when p_status in (401, 403) then 'Rejected: the cron key does not match CRON_SECRET in Cloudflare'
    when p_status = 503 and p_body like '%1102%' then 'Stopped by Cloudflare: processing limit exceeded (error 1102)'
    else 'Error ' || p_status || coalesce(': ' || nullif(left(regexp_replace(p_body, '<[^>]+>', '', 'g'), 160), ''), '')
  end
$$;

/** Store one check; returns a line for the alert email when it changed. */
create or replace function private.health_set(
  p_key text, p_label text, p_sort int, p_ok boolean, p_detail text, p_last_ok timestamptz
) returns text language plpgsql security definer set search_path = public as $$
declare
  prev public.system_health%rowtype;
begin
  select * into prev from public.system_health where check_key = p_key;
  insert into public.system_health as s (check_key, label, sort, ok, detail, failing_since, last_ok_at, checked_at)
  values (p_key, p_label, p_sort, p_ok, p_detail, case when p_ok then null else now() end, p_last_ok, now())
  on conflict (check_key) do update set
    label = excluded.label,
    sort = excluded.sort,
    ok = excluded.ok,
    detail = excluded.detail,
    failing_since = case when excluded.ok then null when s.ok then now() else s.failing_since end,
    last_ok_at = coalesce(excluded.last_ok_at, s.last_ok_at),
    checked_at = now();
  if (prev.check_key is null and not p_ok) or (prev.check_key is not null and prev.ok is distinct from p_ok) then
    insert into public.system_health_log (check_key, label, ok, detail) values (p_key, p_label, p_ok, p_detail);
    return case when p_ok then 'Recovered: ' || p_label else 'FAILING: ' || p_label || '. ' || coalesce(p_detail, '') end;
  end if;
  return null;
end;
$$;

/** Email the changes straight to Resend (not via the site). */
create or replace function private.health_alert(p_lines text[])
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key  text;
  v_cfg  private.follow_up_config%rowtype;
  v_fail boolean := exists (select 1 from unnest(p_lines) l where l like 'FAILING%');
  v_html text;
  req    bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if v_key is null then
    return;
  end if;
  select * into v_cfg from private.follow_up_config where id = 1;
  select string_agg('<li>' || replace(replace(replace(l, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</li>', '')
    into v_html from unnest(p_lines) l;
  req := net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object(
      'from', 'ExPac Motion <support@expac.co.za>',
      'to', jsonb_build_array(coalesce(nullif(v_cfg.alert_email, ''), 'support@expac.co.za')),
      'subject', case when v_fail then 'Motion alert: a background job is failing' else 'Motion: background jobs recovered' end,
      'html', '<p>Motion''s health check found a change:</p><ul>' || v_html || '</ul>'
        || case when coalesce(v_cfg.site_url, '') <> ''
             then '<p><a href="' || v_cfg.site_url || '/settings?tab=health">Open Settings, System health</a></p>' else '' end,
      'text', array_to_string(p_lines, E'\n')
    ),
    timeout_milliseconds := 20000
  );
  -- Tracked, so the email check below doesn't count the alert itself.
  insert into private.job_calls (request_id, job) values (req, 'alert-email') on conflict do nothing;
exception when others then
  null;  -- the alert is best-effort; the banner still shows the problem
end;
$$;

create or replace function public.system_health_check()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  j         record;
  v_last_ok timestamptz;
  v_first   timestamptz;
  v_status  int;
  v_timeout boolean;
  v_error   text;
  v_body    text;
  v_ok      boolean;
  v_detail  text;
  v_count   int;
  v_forms   int;
  v_line    text;
  v_lines   text[] := '{}';
begin
  -- The four scheduled jobs: failing when no successful reply inside the
  -- window (a single bad run doesn't alert; a stopped job does).
  for j in
    select * from (values
      ('inbox-sync',        'Inbox sync (support@ mailbox)',  15, 1),
      ('vessel-sync',       'Vessel positions (live tracking)', 35, 2),
      ('tracking-register', 'Shipment tracking registration',  35, 3),
      ('sage-sync',         'Sage accounting sync',            75, 4)
    ) as t(job, label, mins, sort)
  loop
    continue when not exists (select 1 from cron.job where jobname = j.job and active);
    select max(c.called_at) into v_last_ok
      from private.job_calls c join net._http_response h on h.id = c.request_id
     where c.job = j.job and h.status_code between 200 and 299;
    select min(called_at) into v_first from private.job_calls where job = j.job;
    select h.status_code, h.timed_out, h.error_msg, h.content::text
      into v_status, v_timeout, v_error, v_body
      from private.job_calls c join net._http_response h on h.id = c.request_id
     where c.job = j.job
     order by c.called_at desc limit 1;
    if v_first is null then
      v_ok := true;  v_detail := 'Waiting for its first run';
    elsif v_last_ok > now() - make_interval(mins => j.mins) then
      v_ok := true;  v_detail := null;
    elsif v_first > now() - make_interval(mins => j.mins) then
      -- Only just started being tracked: fail only on an error reply.
      v_ok := not found or v_status between 200 and 299;
      v_detail := case when v_ok then null else private.health_reason(v_status, v_timeout, v_error, v_body) end;
    else
      v_ok := false;
      v_detail := case
        when not found then 'No reply from the site to any recent run'
        else private.health_reason(v_status, v_timeout, v_error, v_body)
      end;
    end if;
    v_line := private.health_set(j.job, j.label, j.sort, v_ok, v_detail, v_last_ok);
    if v_line is not null then v_lines := v_lines || v_line; end if;
  end loop;

  -- Email notifications: every other call goes to /api/send-mail (website
  -- forms, follow-ups, campaigns). Rejected / server errors / no reply in
  -- the last 30 minutes. 4xx validation errors (a bad address) don't count.
  select count(*) into v_count
    from net._http_response h
   where h.created > now() - interval '30 minutes'
     and not exists (select 1 from private.job_calls c where c.request_id = h.id)
     and (h.status_code is null or h.status_code in (401, 403) or h.status_code >= 500);
  select max(h.created) into v_last_ok
    from net._http_response h
   where h.status_code between 200 and 299
     and not exists (select 1 from private.job_calls c where c.request_id = h.id);
  if v_count = 0 then
    v_ok := true;  v_detail := null;
  else
    select h.status_code, h.timed_out, h.error_msg, h.content::text
      into v_status, v_timeout, v_error, v_body
      from net._http_response h
     where h.created > now() - interval '30 minutes'
       and not exists (select 1 from private.job_calls c where c.request_id = h.id)
       and (h.status_code is null or h.status_code in (401, 403) or h.status_code >= 500)
     order by h.created desc limit 1;
    select count(*) into v_forms from public.web_form_submissions where created_at > now() - interval '30 minutes';
    v_ok := false;
    v_detail := private.health_reason(v_status, v_timeout, v_error, v_body)
      || '. ' || v_count || ' email' || case when v_count = 1 then '' else 's' end || ' failed in the last 30 minutes'
      || case when v_forms > 0
           then ', including website enquiries (' || v_forms || ' in that time, saved in Motion but you may not have been emailed)'
           else '' end;
  end if;
  v_line := private.health_set('send-mail', 'Email notifications (website forms, follow-ups, campaigns)', 5, v_ok, v_detail, v_last_ok);
  if v_line is not null then v_lines := v_lines || v_line; end if;

  if cardinality(v_lines) > 0 then
    perform private.health_alert(v_lines);
  end if;

  delete from private.job_calls where called_at < now() - interval '2 days';
  delete from public.system_health_log where at < now() - interval '180 days';
end;
$$;
revoke all on function public.system_health_check() from public, anon, authenticated;

-- ---------- 4. Schedules ----------
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, no background jobs or health checks';
    return;
  end if;
  -- The direct jobs, same timings as before, now through call_job().
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('inbox-sync', 'vessel-sync', 'tracking-register', 'sage-sync', 'system-health');
  perform cron.schedule('inbox-sync', '* * * * *',
    $c$select private.call_job('inbox-sync', '/api/inbox-sync', 55000)$c$);
  perform cron.schedule('vessel-sync', '*/10 * * * *',
    $c$select private.call_job('vessel-sync', '/api/vessel-sync', 55000)$c$);
  perform cron.schedule('tracking-register', '5-59/10 * * * *',
    $c$select private.call_job('tracking-register', '/api/tracking-register', 55000)$c$);
  perform cron.schedule('sage-sync', '*/30 * * * *',
    $c$select private.call_job('sage-sync', '/api/sage-sync', 60000)$c$);
  perform cron.schedule('system-health', '2-59/5 * * * *', 'select public.system_health_check()');
end $$;

notify pgrst, 'reload schema';
