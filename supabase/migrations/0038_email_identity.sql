-- ============================================================
-- 0038  Configurable email identity: sender name, reply-to, signature
-- ============================================================
-- Adds three columns to company_settings, editable from Settings -> Email.
-- The sender name + reply-to + signature are applied to campaign emails
-- (client-side), and to follow-up + web-form-notification emails
-- (re-emits process_due_follow_ups / submit_web_form to read them).
-- send-mail.ts now accepts fromName / replyTo in the request body.
--
-- Run in the Supabase SQL editor after 0037. Self-contained & idempotent.

alter table public.company_settings
  add column if not exists mail_sender_name    text not null default 'EXPAC Forwarding',
  add column if not exists mail_reply_to       text not null default 'support@expac.co.za',
  add column if not exists mail_signature_html text not null default '';

update public.company_settings
set mail_sender_name = 'Support | EXPAC (ZAJNB)'
where id = 1;

-- ------------------------------------------------------------
-- process_due_follow_ups() -- now stamps the configured sender
-- name / reply-to and appends the signature.
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
  v_sender   text;
  v_reply    text;
  v_sig      text;
begin
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'not authorized';
  end if;

  select * into v_cfg from private.follow_up_config where id = 1;
  if v_cfg.site_url is null or v_cfg.site_url = '' then
    return 0;
  end if;

  select mail_sender_name, mail_reply_to, mail_signature_html
    into v_sender, v_reply, v_sig
  from public.company_settings where id = 1;

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
        select q.id::text as skey, null::uuid as lead_id, c.email as email,
               coalesce(c.contact, c.company) as nm, c.company as co
        from public.quotes q
        join public.clients c on c.id = q.client_id
        where v_rule.trigger = 'quote_quiet'
          and q.status = 'sent'
          and q.updated_at <= now() - make_interval(days => v_rule.delay_days)
          and coalesce(c.email, '') <> ''

        union all
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
        continue;
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
      if coalesce(v_sig, '') <> '' then
        v_html := v_html || '<br><br>' || v_sig;
      end if;
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
          'text', v_text,
          'fromName', coalesce(v_sender, ''),
          'replyTo', coalesce(v_reply, '')
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.process_due_follow_ups() to authenticated;

-- ------------------------------------------------------------
-- submit_web_form() -- notification email now uses the sender name.
-- ------------------------------------------------------------
create or replace function public.submit_web_form(
  p_id uuid,
  p_data jsonb,
  p_utm jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form    public.web_forms%rowtype;
  v_field   jsonb;
  v_map     text;
  v_val     text;
  v_company text := '';
  v_contact text := '';
  v_email   text := '';
  v_phone   text := '';
  v_notes   text := '';
  v_lead_id uuid;
  v_cfg     private.follow_up_config%rowtype;
  v_sender  text;
begin
  select * into v_form from public.web_forms where id = p_id and active = true;
  if v_form.id is null then
    return jsonb_build_object('ok', false, 'error', 'Form not found');
  end if;

  select mail_sender_name into v_sender from public.company_settings where id = 1;

  for v_field in select * from jsonb_array_elements(v_form.fields)
  loop
    v_map := coalesce(v_field->>'mapTo', 'none');
    v_val := btrim(coalesce(p_data->>(v_field->>'id'), ''));
    if v_val = '' then
      continue;
    end if;
    if v_map = 'company' then
      v_company := v_val;
    elsif v_map = 'contact' then
      v_contact := v_val;
    elsif v_map = 'email' then
      v_email := lower(v_val);
    elsif v_map = 'phone' then
      v_phone := v_val;
    elsif v_map = 'notes' then
      v_notes := v_notes
        || case when v_notes = '' then '' else E'\n' end
        || coalesce(v_field->>'label', 'Field') || ': ' || v_val;
    end if;
  end loop;

  if v_company = '' then
    v_company := coalesce(nullif(v_contact, ''), nullif(v_email, ''), 'Web form lead');
  end if;

  insert into public.leads (company, contact, email, phone, notes, source)
  values (
    v_company,
    nullif(v_contact, ''),
    nullif(v_email, ''),
    nullif(v_phone, ''),
    nullif(v_notes, ''),
    'Web form: ' || v_form.name
  )
  returning id into v_lead_id;

  insert into public.web_form_submissions (form_id, lead_id, data, utm)
  values (
    v_form.id,
    v_lead_id,
    coalesce(p_data, '{}'::jsonb),
    case when v_form.track_url_params then coalesce(p_utm, '{}'::jsonb) else '{}'::jsonb end
  );

  insert into public.ops_tasks (kind, title, body, priority, due_date)
  values (
    'task',
    'New web-form lead: ' || v_company,
    'Submitted via "' || v_form.name || '"'
      || case when v_email <> '' then E'\nEmail: ' || v_email else '' end
      || case when v_phone <> '' then E'\nPhone: ' || v_phone else '' end
      || case when v_notes <> '' then E'\n' || v_notes else '' end,
    'high',
    current_date
  );

  if v_form.notify_email is not null and v_form.notify_email <> '' then
    begin
      select * into v_cfg from private.follow_up_config where id = 1;
      if v_cfg.site_url is not null and v_cfg.site_url <> '' then
        perform net.http_post(
          url := v_cfg.site_url || '/api/send-mail',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-key', v_cfg.cron_secret
          ),
          body := jsonb_build_object(
            'to', jsonb_build_array(v_form.notify_email),
            'subject', 'New lead from ' || v_form.name || ': ' || v_company,
            'html',
              '<p>A new lead just submitted <b>' || v_form.name || '</b>.</p>'
              || '<p>Company: ' || v_company
              || '<br>Email: ' || coalesce(nullif(v_email, ''), '-')
              || '<br>Phone: ' || coalesce(nullif(v_phone, ''), '-') || '</p>'
              || case when v_notes <> '' then '<pre>' || v_notes || '</pre>' else '' end,
            'text', 'New lead: ' || v_company || ' <' || v_email || '>',
            'fromName', coalesce(v_sender, '')
          )
        );
      end if;
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.submit_web_form(uuid, jsonb, jsonb) to anon, authenticated;
