-- ============================================================
-- 0209  System health: "not set up yet" is not a failure
-- ============================================================
-- Sage isn't connected yet (no SAGE_* secrets), so /api/sage-sync answers
-- 503 {"notConnected": true} on every run, and 0207 flagged it as failing
-- (and one such reply from just before 0207's reschedule was counted under
-- email notifications). The inbox does the same without IMAP_* secrets.
--
-- Now: a notConnected reply counts as OK with "Not set up yet", and never
-- counts as a failed email. Runs the check once at the end, so the state
-- is right straight away.
--
-- Run in the Supabase SQL editor after 0208. Self-contained & idempotent.

/** A reply in plain words; a JSON body's "error" message instead of the raw JSON. */
create or replace function private.health_reason(p_status int, p_timed_out boolean, p_error text, p_body text)
returns text language plpgsql immutable as $$
declare
  v_msg text := regexp_replace(coalesce(p_body, ''), '<[^>]+>', '', 'g');
begin
  begin
    v_msg := coalesce(p_body::jsonb ->> 'error', p_body::jsonb ->> 'message', v_msg);
  exception when others then
    null;  -- not JSON
  end;
  return case
    when p_timed_out then 'Timed out, the site did not answer in time'
    when p_status is null and p_error is not null then 'Could not reach the site: ' || left(p_error, 160)
    when p_status is null then 'No reply from the site'
    when p_status in (401, 403) then 'Rejected: the cron key does not match CRON_SECRET in Cloudflare'
    when p_status = 503 and p_body like '%1102%' then 'Stopped by Cloudflare: processing limit exceeded (error 1102)'
    else 'Error ' || p_status || coalesce(': ' || nullif(left(trim(v_msg), 200), ''), '')
  end;
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
     where c.job = j.job
       and (h.status_code between 200 and 299 or h.content::text like '%"notConnected":true%');
    select min(called_at) into v_first from private.job_calls where job = j.job;
    select h.status_code, h.timed_out, h.error_msg, h.content::text
      into v_status, v_timeout, v_error, v_body
      from private.job_calls c join net._http_response h on h.id = c.request_id
     where c.job = j.job
     order by c.called_at desc limit 1;
    if found and v_body like '%"notConnected":true%' then
      -- Credentials not added yet (e.g. Sage before its API key): not a failure.
      v_ok := true;  v_detail := 'Not set up yet (its credentials are not added in Cloudflare)';
    elsif v_first is null then
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
     and coalesce(h.content::text, '') not like '%"notConnected"%'
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
       and coalesce(h.content::text, '') not like '%"notConnected"%'
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

select public.system_health_check();
