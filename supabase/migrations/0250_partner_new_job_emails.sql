-- =====================================================================
-- 0250 Partner emails back ON, for new shipments only.
-- =====================================================================
-- 0246 put every automatic partner email on hold. With accept / decline
-- (0249) a partner must hear when a shipment is handed to them, so this
-- switches back on ONLY the "new shipment for you" alert:
--   * trg_partner_alert_job_insert     a new shipment with partners on it
--   * trg_partner_alert_quote_partner  a partner set on a running shipment
--   * the 5-minute "partner-alerts" send job
-- The date-change alert (trg_partner_alert_job_dates) stays OFF, and any
-- other queued kind is skipped (marked sent, never mailed).
-- Clearing agents stay excluded (0245).
--
-- The email now says "New shipment for you to accept", links each
-- shipment straight to /partner/shipments/<id>, and goes to the partner's
-- main email plus every active partner-portal login for that partner.
--
-- Run in the Supabase SQL editor after 0249. Self-contained & idempotent.
-- =====================================================================
begin;

create or replace function public.partner_alerts_send()
returns integer language plpgsql security definer set search_path = public as $$
declare
  cfg record;
  grp record;
  v_main text;
  v_company text;
  v_to jsonb;
  v_login boolean;
  rows_html text;
  rows_text text;
  font constant text := 'font-family:Aptos,''Aptos Display'',Calibri,''Segoe UI'',Helvetica,Arial,sans-serif;';
  btn constant text := 'display:inline-block;background:#719d2f;color:#ffffff;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:6px;';
  sent int := 0;
begin
  select * into cfg from private.follow_up_config where id = 1;
  if cfg.site_url is null or cfg.site_url = '' or cfg.cron_secret = '' then
    return 0;
  end if;

  -- Only new-shipment alerts are mailed; anything else is dropped.
  update public.partner_alerts set sent_at = now() where sent_at is null and kind <> 'assigned';

  for grp in
    select a.partner_kind, a.partner_id, array_agg(a.id) as ids
      from public.partner_alerts a
     where a.sent_at is null and a.kind = 'assigned'
       and a.partner_kind <> 'clearing_agent'
       and a.created_at < now() - interval '2 minutes'
     group by a.partner_kind, a.partner_id
  loop
    v_main := null;
    v_company := null;
    if grp.partner_kind = 'agent' then
      select email, company into v_main, v_company from public.agents where id = grp.partner_id;
    elsif grp.partner_kind = 'transporter' then
      select email, company into v_main, v_company from public.transporters where id = grp.partner_id;
    else
      select email, company into v_main, v_company from public.destination_agents where id = grp.partner_id;
    end if;

    -- Main email + every active login for this partner, once each.
    select coalesce(jsonb_agg(distinct e), '[]'::jsonb) into v_to
      from (
        select lower(btrim(v_main)) as e where coalesce(btrim(v_main), '') <> ''
        union
        select lower(btrim(p.email)) from public.profiles p
         where p.role = 'partner' and p.partner_kind = grp.partner_kind and p.partner_id = grp.partner_id
           and coalesce(btrim(p.email), '') <> ''
      ) x;
    v_login := exists (select 1 from public.profiles p
                        where p.role = 'partner' and p.partner_kind = grp.partner_kind and p.partner_id = grp.partner_id);

    if jsonb_array_length(v_to) > 0 then
      select string_agg(
               '<tr><td style="padding:6px 14px 6px 0;font-weight:bold;">'
               || case when v_login
                    then '<a href="' || cfg.site_url || '/partner/shipments/' || j.id || '" style="color:#4f7a1c;">' || public.mail_esc(j.reference) || '</a>'
                    else public.mail_esc(j.reference) end
               || '</td>'
               || '<td style="padding:6px 14px 6px 0;color:#202426;">' || public.mail_esc(coalesce(j.mode, '')) || '</td>'
               || '<td style="padding:6px 14px 6px 0;color:#202426;">' || public.mail_esc(coalesce(j.origin, '-') || ' to ' || coalesce(j.destination, '-')) || '</td>'
               || '<td style="padding:6px 0;color:#202426;">'
               || coalesce('ETD ' || to_char(j.etd, 'DD/MM/YYYY'), '')
               || coalesce(case when j.etd is not null then ', ' else '' end || 'ETA ' || to_char(j.eta, 'DD/MM/YYYY'), '')
               || '</td></tr>', '' order by a.created_at),
             string_agg(j.reference || ': ' || coalesce(j.origin, '-') || ' to ' || coalesce(j.destination, '-')
                        || case when v_login then ' ' || cfg.site_url || '/partner/shipments/' || j.id else '' end,
                        E'\n' order by a.created_at)
        into rows_html, rows_text
        from public.partner_alerts a join public.jobs j on j.id = a.job_id
       where a.id = any (grp.ids);

      begin
        perform net.http_post(
          url := cfg.site_url || '/api/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', cfg.cron_secret),
          body := jsonb_build_object(
            'to', v_to,
            'subject', 'New shipment for you to accept: ExPac Forwarding',
            'fromName', 'ExPac Forwarding',
            'html',
              '<div style="' || font || 'font-size:11pt;color:#202426;">'
              || '<p>Good day ' || public.mail_esc(coalesce(v_company, '')) || ',</p>'
              || '<p>ExPac Forwarding has handed you the shipment(s) below.'
              || case when v_login
                   then ' Please open each one in the Partner Portal to <b>accept</b> it (or decline and tell us why), then keep the milestones and documents up to date there.'
                   else ' Please reply to confirm you can handle them.' end
              || '</p>'
              || '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;' || font || 'font-size:11pt;">' || rows_html || '</table>'
              || case when v_login
                   then '<p style="margin-top:16px;"><a href="' || cfg.site_url || '/partner/shipments" style="' || btn || '">Review and accept</a></p>'
                   else '' end
              || '<p>Kind regards,<br>ExPac Forwarding</p></div>',
            'text', 'ExPac Forwarding has handed you these shipments'
              || case when v_login then ' to accept in the Partner Portal' else '' end || ':' || E'\n\n' || rows_text
              || case when v_login then E'\n\nPartner Portal: ' || cfg.site_url || '/partner/shipments' else '' end
          )
        );
        sent := sent + 1;
      exception when others then
        null;
      end;
    end if;
    update public.partner_alerts set sent_at = now() where id = any (grp.ids);
  end loop;
  return sent;
end;
$$;
revoke execute on function public.partner_alerts_send() from public, anon, authenticated;

-- Nothing old goes out in a burst: clear the queue, then switch back on.
update public.partner_alerts set sent_at = now() where sent_at is null;

alter table public.jobs   enable trigger trg_partner_alert_job_insert;
alter table public.quotes enable trigger trg_partner_alert_quote_partner;
-- trg_partner_alert_job_dates stays disabled (0246).

select cron.alter_job(jobid, active := true) from cron.job where jobname = 'partner-alerts';

commit;
notify pgrst, 'reload schema';
