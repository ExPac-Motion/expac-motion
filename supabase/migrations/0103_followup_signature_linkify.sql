-- ============================================================
-- 0103  Follow-up emails: stop mobile clients auto-linking the signature
-- ============================================================
-- Re-emits process_due_follow_ups() (unchanged since 0083 other than this)
-- to give the signature a mobile-friendly link treatment before appending
-- it to the mail body:
--   - bare phone numbers (T:/WA:/F: — no <a> of their own) get a tel:
--     link of their own;
--   - any link already in the signature (E:/Office:/Portal:, hand-created
--     via Settings -> Email's rich-text editor) gets our blend-in style
--     merged into it, rather than being re-wrapped — re-wrapping would
--     match the address text a second time inside its own href="mailto:…"
--     attribute and produce broken, nested HTML.
-- Both get color:inherit;text-decoration:none so mobile mail clients —
-- Gmail's app especially — don't apply their own loud blue-underline
-- auto-link styling on top. Same fix already shipped client-side for
-- Shipment/Quotation Comms, Quick Mail and Mail Campaigns
-- (src/lib/mailStyle.ts linkifyHtml/linkifySignature) — this is the one
-- remaining path, since it sends straight from Postgres via net.http_post
-- rather than through the browser.
--
-- Run in the Supabase SQL editor after 0102. Self-contained & idempotent.

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
  v_link_style constant text :=
    'color:inherit!important;text-decoration:none!important';
  v_match    text[];
  v_phone    text;
  v_href     text;
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
        declare
          v_sig_linked text := v_sig;
        begin
          -- Bare phone numbers (no <a> of their own) -> tel: links. The SA
          -- "(0)" trunk-prefix marker and spaces/parens are stripped for
          -- the href only; the displayed text is left exactly as typed.
          for v_match in
            select regexp_matches(v_sig_linked, '\+[0-9][0-9 ()]{6,}[0-9]', 'g')
          loop
            v_phone := v_match[1];
            v_href := 'tel:' || regexp_replace(replace(v_phone, '(0)', ''), '[^0-9+]', '', 'g');
            v_sig_linked := replace(
              v_sig_linked,
              v_phone,
              '<a href="' || v_href || '" style="' || v_link_style || '">' || v_phone || '</a>'
            );
          end loop;

          -- Any link already in the signature (E:/Office:/Portal:) -> merge
          -- our style into its existing style attribute, or add one if it
          -- has none, without touching its href or content.
          v_sig_linked := regexp_replace(
            v_sig_linked,
            '(<a\s[^>]*?style=")',
            '\1' || v_link_style || ';',
            'g'
          );
          v_sig_linked := regexp_replace(
            v_sig_linked,
            '<a((?:(?!style=)[^>])*)>',
            '<a style="' || v_link_style || '"\1>',
            'g'
          );

          v_html := v_html || '<br><br>' || v_sig_linked;
        end;
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
          'replyTo', coalesce(v_reply, ''),
          'unsubscribeUrl', v_cfg.site_url || '/api/unsubscribe?r=' || v_log_id
        )
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.process_due_follow_ups() to authenticated;
