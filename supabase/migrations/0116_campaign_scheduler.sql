-- ============================================================
-- 0116  Mail campaigns: scheduled (server-side) sending
-- ============================================================
-- A campaign can be scheduled for a date/time instead of sent from the
-- browser. At scheduling time the app renders every recipient's final
-- subject / HTML / text (merge fields, signature, unsubscribe link) into
-- mail_campaign_recipients, so the server only has to deliver them.
--
-- A pg_cron job runs process_scheduled_campaigns() every minute. Each run:
--   1. settles recipients dispatched on an earlier run, from pg_net's
--      response log (net._http_response): 2xx -> sent (+ Resend id, so the
--      open/click webhook keeps working), 429 -> re-queued, else failed;
--   2. closes campaigns with nothing left pending;
--   3. flips due 'scheduled' campaigns to 'sending' and dispatches up to 20
--      recipients through /api/send-mail (x-cron-key, same as follow-ups).
--      20/minute keeps under Resend's rate limit; a 429 just retries.
--
-- Uses the follow-up config (private.follow_up_config: site_url +
-- cron_secret) and needs pg_cron + pg_net -- both already used by 0035.
--
-- Run in the Supabase SQL editor after 0115. Self-contained & idempotent.

alter table public.mail_campaigns
  add column if not exists scheduled_at timestamptz,
  add column if not exists from_name    text,
  add column if not exists reply_to     text;

alter table public.mail_campaigns drop constraint if exists mail_campaigns_status_check;
alter table public.mail_campaigns add constraint mail_campaigns_status_check
  check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));

alter table public.mail_campaign_recipients
  add column if not exists subject        text,
  add column if not exists html           text,
  add column if not exists body_text      text,
  add column if not exists net_request_id bigint,
  add column if not exists dispatched_at  timestamptz;

create index if not exists mail_campaigns_scheduled_idx
  on public.mail_campaigns (scheduled_at) where status in ('scheduled', 'sending');

create or replace function public.process_scheduled_campaigns()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg   record;
  v_r     record;
  v_resp  record;
  v_req   bigint;
  v_n     int := 0;
begin
  select site_url, cron_secret into v_cfg from private.follow_up_config where id = 1;
  if coalesce(v_cfg.site_url, '') = '' or coalesce(v_cfg.cron_secret, '') = '' then
    raise notice 'private.follow_up_config site_url / cron_secret not set';
    return 0;
  end if;

  -- 1. Settle earlier dispatches from pg_net's response log.
  for v_r in
    select r.id, r.net_request_id, r.dispatched_at
    from public.mail_campaign_recipients r
    where r.status = 'pending' and r.net_request_id is not null
  loop
    select status_code, content, error_msg, timed_out
      into v_resp
      from net._http_response
     where id = v_r.net_request_id;
    if not found then
      -- pg_net keeps responses ~6h; anything older than that never answered.
      if v_r.dispatched_at < now() - interval '6 hours' then
        update public.mail_campaign_recipients
           set status = 'failed', error = 'No response from the mail service'
         where id = v_r.id;
      end if;
      continue;
    end if;
    if v_resp.status_code between 200 and 299 then
      update public.mail_campaign_recipients
         set status = 'sent',
             sent_at = now(),
             provider_id = nullif(
               (case when v_resp.content ~ '^\s*\{' then v_resp.content::jsonb ->> 'id' end), '')
       where id = v_r.id;
    elsif v_resp.status_code = 429 or coalesce(v_resp.timed_out, false) then
      -- Rate-limited / timed out: send again on a later run.
      update public.mail_campaign_recipients
         set net_request_id = null, dispatched_at = null
       where id = v_r.id;
    else
      update public.mail_campaign_recipients
         set status = 'failed',
             error = left(coalesce(v_resp.content, v_resp.error_msg, 'Send failed'), 300)
       where id = v_r.id;
    end if;
  end loop;

  -- 2. Close campaigns that have nothing left to send.
  update public.mail_campaigns c
     set status = case
                    when exists (select 1 from public.mail_campaign_recipients r
                                  where r.campaign_id = c.id and r.status <> 'failed')
                    then 'sent' else 'failed' end,
         sent_at = now()
   where c.status = 'sending'
     and c.scheduled_at is not null
     and not exists (select 1 from public.mail_campaign_recipients r
                      where r.campaign_id = c.id and r.status = 'pending');

  -- 3. Start due campaigns, then dispatch the next batch.
  update public.mail_campaigns
     set status = 'sending'
   where status = 'scheduled' and scheduled_at <= now();

  for v_r in
    select r.id, r.email, r.subject, r.html, r.body_text, r.lead_id,
           c.from_name, c.reply_to, l.unsubscribed_at
    from public.mail_campaign_recipients r
    join public.mail_campaigns c on c.id = r.campaign_id
    left join public.leads l on l.id = r.lead_id
    where c.status = 'sending'
      and c.scheduled_at is not null
      and r.status = 'pending'
      and r.net_request_id is null
    order by c.scheduled_at, r.created_at
    limit 20
    for update of r skip locked
  loop
    if v_r.unsubscribed_at is not null then
      update public.mail_campaign_recipients
         set status = 'failed', error = 'Unsubscribed before the send'
       where id = v_r.id;
      continue;
    end if;
    if v_r.html is null then
      update public.mail_campaign_recipients
         set status = 'failed', error = 'No rendered message stored'
       where id = v_r.id;
      continue;
    end if;
    v_req := net.http_post(
      url := v_cfg.site_url || '/api/send-mail',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', v_cfg.cron_secret
      ),
      body := jsonb_build_object(
        'to', jsonb_build_array(v_r.email),
        'subject', coalesce(v_r.subject, ''),
        'html', v_r.html,
        'text', coalesce(v_r.body_text, ''),
        'fromName', coalesce(v_r.from_name, ''),
        'replyTo', coalesce(v_r.reply_to, ''),
        'unsubscribeUrl', v_cfg.site_url || '/api/unsubscribe?r=' || v_r.id
      )
    );
    update public.mail_campaign_recipients
       set net_request_id = v_req, dispatched_at = now()
     where id = v_r.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

grant execute on function public.process_scheduled_campaigns() to authenticated;

-- every minute -- best-effort; skipped with a notice if pg_cron isn't enabled.
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled — enable it in the dashboard, then re-run this DO block';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'process-scheduled-campaigns') then
    perform cron.unschedule('process-scheduled-campaigns');
  end if;
  perform cron.schedule(
    'process-scheduled-campaigns',
    '* * * * *',
    'select public.process_scheduled_campaigns();'
  );
end $$;
