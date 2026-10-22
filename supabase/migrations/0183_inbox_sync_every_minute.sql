-- 0183: Inbox sync every minute, with time to finish.
--   The 0134 job called /api/inbox-sync every 5 minutes with pg_net's
--   default 5-second timeout. Since the year-long backfill (0181) most runs
--   take longer than that, and a run cut off mid-way stored nothing, so new
--   mail only showed up on "Sync now" or opening the Inbox. Now: every
--   minute, 55 seconds allowed (the same as the Sage sync's 60s, 0156).

do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, the inbox syncs only on Sync now / page open';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'inbox-sync') then
    perform cron.unschedule('inbox-sync');
  end if;
  perform cron.schedule(
    'inbox-sync',
    '* * * * *',
    $cron$
      select net.http_post(
        url := c.site_url || '/api/inbox-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      from private.follow_up_config c
      where c.site_url is not null and c.cron_secret is not null
      limit 1;
    $cron$
  );
end $$;
