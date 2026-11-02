-- ============================================================
-- 0208  Health alert emails: send from the Resend-verified domain
-- ============================================================
-- 0207's alert sent from support@expac.co.za, but the domain verified in
-- Resend is send.expac.co.za (Resend answered 403 "domain is not
-- verified"). The sender is now a setting, defaulting to that domain, and
-- replies go to support@expac.co.za.
--
-- Run in the Supabase SQL editor after 0207. Self-contained & idempotent.

alter table private.follow_up_config
  add column if not exists alert_from text not null default 'ExPac Motion <alerts@send.expac.co.za>';

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
      'from', coalesce(nullif(v_cfg.alert_from, ''), 'ExPac Motion <alerts@send.expac.co.za>'),
      'reply_to', 'support@expac.co.za',
      'to', jsonb_build_array(coalesce(nullif(v_cfg.alert_email, ''), 'support@expac.co.za')),
      'subject', case when v_fail then 'Motion alert: a background job is failing' else 'Motion: background jobs recovered' end,
      'html', '<p>Motion''s health check found a change:</p><ul>' || v_html || '</ul>'
        || case when coalesce(v_cfg.site_url, '') <> ''
             then '<p><a href="' || v_cfg.site_url || '/settings?tab=health">Open Settings, System health</a></p>' else '' end,
      'text', array_to_string(p_lines, E'\n')
    ),
    timeout_milliseconds := 20000
  );
  -- Tracked, so the email check doesn't count the alert itself.
  insert into private.job_calls (request_id, job) values (req, 'alert-email') on conflict do nothing;
exception when others then
  null;  -- the alert is best-effort; the banner still shows the problem
end;
$$;
