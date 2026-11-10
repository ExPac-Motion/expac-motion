-- ============================================================
-- 0233  Website request emails: a proper layout + "ExPac Forwarding"
-- ============================================================
-- The team email for a website quote request / lead (0174, 0176, 0178)
-- was a few lines plus a monospace <pre> dump of the enquiry. It now goes
-- out as a laid-out card in the house font (Aptos 11pt):
--   * what came in, the company name as the heading, a green
--     "Open quote ..." button;
--   * Contact (company, contact, email, phone; email and phone clickable);
--   * Shipment (mode, from, to, incoterm, cargo, commodity, ...);
--   * Sender / Receiver side by side; Notes.
-- Built from tables with inline styles so it renders the same in Outlook.
-- Everything the visitor typed is HTML-escaped.
--
--   1. public.web_request_mail_html(): renders the card from the existing
--      "Label: value" enquiry summary.
--   2. submit_quote_request() and submit_web_form() as in 0178, with the
--      new html.
--   3. Sender name "EXPAC Forwarding" -> "ExPac Forwarding" (Settings
--      email identity + its default).
--
-- Run in the Supabase SQL editor after 0232. Self-contained & idempotent.

create or replace function public.mail_esc(p text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;');
$$;

create or replace function public.web_request_mail_html(
  p_title   text,
  p_form    text,
  p_company text,
  p_contact text,
  p_email   text,
  p_phone   text,
  p_url     text,
  p_ref     text,
  p_summary text
)
returns text
language plpgsql
stable
as $$
declare
  font     constant text := 'font-family:Aptos,''Aptos Display'',Calibri,''Segoe UI'',Helvetica,Arial,sans-serif;';
  head_st  constant text := 'padding:18px 0 6px;font-size:9.5pt;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#02a5aa;border-bottom:1px solid #e3e3e3;';
  lbl_st   constant text := 'padding:6px 12px 6px 0;width:150px;vertical-align:top;color:#6b6b6b;';
  val_st   constant text := 'padding:6px 0;vertical-align:top;color:#202426;font-weight:bold;';
  link_st  constant text := 'color:#02a5aa;text-decoration:none;';
  v_rows   text := '';
  v_blocks text[] := '{}';
  v_titles text[] := '{}';
  v_cur    int := 0;
  v_line   text;
  v_key    text;
  v_val    text;
  v_party  text := '';
  v_other  text := '';
  v_html   text;
  i        int;
begin
  -- Summary: "Label: value" lines, then blank-line separated blocks that
  -- start with a "Heading:" line (Sender / Receiver / Notes).
  foreach v_line in array string_to_array(coalesce(p_summary, ''), E'\n') loop
    v_line := btrim(v_line);
    if v_line = '' then
      v_cur := 0;
    elsif v_cur = 0 and v_line ~ ':$' and length(v_line) <= 60 then
      v_titles := v_titles || left(v_line, -1);
      v_blocks := v_blocks || ''::text;
      v_cur := cardinality(v_blocks);
    elsif v_cur > 0 then
      v_blocks[v_cur] := v_blocks[v_cur]
        || case when v_blocks[v_cur] = '' then '' else '<br>' end || public.mail_esc(v_line);
    elsif v_line ~ '^[^:]{1,40}: ' then
      v_key := split_part(v_line, ': ', 1);
      v_val := substr(v_line, length(v_key) + 3);
      v_rows := v_rows || '<tr><td style="' || lbl_st || '">' || public.mail_esc(v_key)
        || '</td><td style="' || val_st || '">' || public.mail_esc(v_val) || '</td></tr>';
    else
      v_rows := v_rows || '<tr><td style="' || lbl_st || '"></td><td style="' || val_st || '">'
        || public.mail_esc(v_line) || '</td></tr>';
    end if;
  end loop;

  -- Sender + receiver side by side; any other block (Notes) full width.
  for i in 1 .. coalesce(cardinality(v_titles), 0) loop
    if v_titles[i] ~* '^(sender|receiver)' then
      v_party := v_party || '<td width="50%" style="padding:10px 16px 0 0;vertical-align:top;">'
        || '<div style="font-size:9.5pt;font-weight:bold;color:#6b6b6b;padding-bottom:4px;">' || public.mail_esc(v_titles[i]) || '</div>'
        || '<div style="color:#202426;line-height:1.5;">' || v_blocks[i] || '</div></td>';
    else
      v_other := v_other
        || '<tr><td style="' || head_st || '">' || public.mail_esc(v_titles[i]) || '</td></tr>'
        || '<tr><td style="padding:10px 0 0;color:#202426;line-height:1.5;">' || v_blocks[i] || '</td></tr>';
    end if;
  end loop;

  v_html :=
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="' || font || 'font-size:11pt;line-height:1.45;color:#333333;max-width:640px;">'
    || '<tr><td style="padding:0 0 2px;font-size:9.5pt;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#02a5aa;">'
    || public.mail_esc(coalesce(p_title, 'New request')) || '</td></tr>'
    || '<tr><td style="padding:0 0 6px;font-size:17pt;font-weight:bold;color:#202426;line-height:1.25;">'
    || public.mail_esc(p_company) || '</td></tr>'
    || '<tr><td style="padding:0 0 16px;color:#6b6b6b;">Came in on <b style="color:#333333;">' || public.mail_esc(p_form) || '</b>'
    || coalesce(' &middot; ' || public.mail_esc(nullif(p_ref, '')), '') || ' &middot; '
    || to_char(now() at time zone 'Africa/Johannesburg', 'DD/MM/YYYY HH24:MI') || '</td></tr>';

  if nullif(p_url, '') is not null then
    v_html := v_html
      || '<tr><td style="padding:0 0 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
      || '<td bgcolor="#8cbc43" style="background:#8cbc43;border-radius:6px;padding:10px 22px;">'
      || '<a href="' || public.mail_esc(p_url) || '" style="' || font || 'font-size:11pt;font-weight:bold;color:#ffffff;text-decoration:none;display:inline-block;">'
      || 'Open quote ' || public.mail_esc(coalesce(nullif(p_ref, ''), '')) || '</a></td></tr></table></td></tr>';
  end if;

  v_html := v_html
    || '<tr><td style="' || head_st || '">Contact</td></tr>'
    || '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="' || font || 'font-size:11pt;">'
    || '<tr><td style="' || lbl_st || '">Company</td><td style="' || val_st || '">' || public.mail_esc(p_company) || '</td></tr>'
    || case when nullif(btrim(p_contact), '') is not null and btrim(p_contact) <> btrim(p_company)
         then '<tr><td style="' || lbl_st || '">Contact</td><td style="' || val_st || '">' || public.mail_esc(p_contact) || '</td></tr>' else '' end
    || '<tr><td style="' || lbl_st || '">Email</td><td style="' || val_st || '">'
    || case when nullif(p_email, '') is not null
         then '<a href="mailto:' || public.mail_esc(p_email) || '" style="' || link_st || '">' || public.mail_esc(p_email) || '</a>' else '-' end
    || '</td></tr>'
    || '<tr><td style="' || lbl_st || '">Phone</td><td style="' || val_st || '">'
    || case when nullif(p_phone, '') is not null
         then '<a href="tel:' || public.mail_esc(regexp_replace(p_phone, '[^0-9+]', '', 'g')) || '" style="' || link_st || '">' || public.mail_esc(p_phone) || '</a>' else '-' end
    || '</td></tr></table></td></tr>';

  if v_rows <> '' then
    v_html := v_html
      || '<tr><td style="' || head_st || '">Shipment</td></tr>'
      || '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="' || font || 'font-size:11pt;">'
      || v_rows || '</table></td></tr>';
  end if;

  if v_party <> '' then
    v_html := v_html
      || '<tr><td style="' || head_st || '">Collection &amp; delivery</td></tr>'
      || '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="' || font || 'font-size:11pt;"><tr>'
      || v_party || '</tr></table></td></tr>';
  end if;

  return v_html || v_other || '</table>';
end;
$$;

-- submit_quote_request as in 0178, with the new html.
create or replace function public.submit_quote_request(
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
  v_form      public.web_forms%rowtype;
  d           jsonb := coalesce(p_data, '{}');
  v_contact   text := btrim(coalesce(d ->> 'name', ''));
  v_company   text := btrim(coalesce(d ->> 'company', ''));
  v_email     text := lower(btrim(coalesce(d ->> 'email', '')));
  v_phone     text := btrim(coalesce(d ->> 'phone', ''));
  v_choice    text := btrim(coalesce(d ->> 'mode', ''));
  v_mode      text;
  v_origin    text := btrim(coalesce(d ->> 'origin', ''));
  v_dest      text := btrim(coalesce(d ->> 'destination', ''));
  v_inco      text := upper(btrim(coalesce(d ->> 'incoterms', '')));
  v_sender    text := public.web_party_text(d -> 'sender');
  v_receiver  text := public.web_party_text(d -> 'receiver');
  v_lead      public.leads%rowtype;
  v_status_id uuid;
  v_settings  public.company_settings%rowtype;
  v_ref       text;
  v_quote_id  uuid;
  v_enquiry   text;
  v_summary   text;
  v_item      jsonb;
  v_pos       int := 0;
  v_pieces    numeric := 0;
  v_kg        numeric := 0;
  v_cfg       private.follow_up_config%rowtype;
begin
  select * into v_form from public.web_forms where id = p_id and active = true;
  if v_form.id is null then
    return jsonb_build_object('ok', false, 'error', 'Form not found');
  end if;

  -- Bots fill the hidden "website" field: say thanks, keep nothing.
  if btrim(coalesce(d ->> 'website', '')) <> '' then
    return jsonb_build_object('ok', true);
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.');
  end if;
  if (select count(*) from public.web_form_submissions s
       where s.created_at > now() - interval '10 minutes'
         and lower(s.data ->> 'email') = v_email) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'We have your requests, the team will be in touch shortly.');
  end if;

  v_mode := coalesce(public.web_form_quote_mode(v_choice), 'Air Freight (AIR)');
  if v_inco not in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP') then
    v_inco := null;
  end if;
  -- Lane pages ask for a city in the lane's country: "Shenzhen" -> "Shenzhen, China".
  if v_origin <> '' and v_form.lane_origin_country is not null
     and v_origin not ilike ('%' || v_form.lane_origin_country || '%') then
    v_origin := v_origin || ', ' || v_form.lane_origin_country;
  end if;
  if v_company = '' then
    v_company := coalesce(nullif(v_contact, ''), v_email);
  end if;

  -- Packing totals for the enquiry summary / team email.
  for v_item in select * from jsonb_array_elements(coalesce(d -> 'packing', '[]')) limit 60 loop
    v_pieces := v_pieces + coalesce(public.try_numeric(v_item ->> 'qty_ctns'), 0);
    v_kg := v_kg + coalesce(public.try_numeric(v_item ->> 'qty_ctns'), 0) * coalesce(public.try_numeric(v_item ->> 'actual_kg'), 0);
  end loop;

  v_summary := concat_ws(E'\n',
    'Mode: ' || coalesce(nullif(v_choice, ''), 'Not sure'),
    'From: ' || coalesce(nullif(v_origin, ''), '-'),
    'To: ' || coalesce(nullif(v_dest, ''), '-'),
    'Incoterm: ' || coalesce(nullif(d ->> 'incoterms', ''), 'Not sure'),
    'Cargo ready: ' || coalesce(nullif(d ->> 'ready_date', ''), '-'),
    case when v_pieces > 0 then 'Cargo: ' || v_pieces || ' pcs, ' || round(v_kg, 1) || ' kg (packing list on the quote)' end,
    case when nullif(btrim(d ->> 'containers'), '') is not null then 'Containers: ' || btrim(d ->> 'containers') end,
    case when nullif(btrim(d ->> 'commodity'), '') is not null then 'Commodity: ' || btrim(d ->> 'commodity') end,
    case when public.try_numeric(d ->> 'value') is not null
      then 'Goods value: ' || coalesce(nullif(d ->> 'value_currency', ''), 'USD') || ' ' || (d ->> 'value') end,
    case when nullif(btrim(d ->> 'customs_registered'), '') is not null then 'Customs registered: ' || btrim(d ->> 'customs_registered') end,
    case when nullif(btrim(d ->> 'referral'), '') is not null then 'Referral code: ' || btrim(d ->> 'referral') end,
    case when v_sender is not null then E'\nSender (collect from):\n' || v_sender end,
    case when v_receiver is not null then E'\nReceiver (deliver to):\n' || v_receiver end,
    case when nullif(btrim(d ->> 'notes'), '') is not null then E'\nNotes:\n' || btrim(d ->> 'notes') end);

  v_enquiry := 'Website quote request "' || v_form.name || '", '
    || to_char(now() at time zone 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI')
    || E'\n\n' || v_summary;

  -- Lead: same email as an existing lead -> that lead, new enquiry on top of
  -- its notes; otherwise a new lead with the "Contact Page" status (as 0172).
  select * into v_lead from public.leads where lower(email) = v_email order by created_at desc limit 1;
  if v_lead.id is not null then
    update public.leads set
      contact = coalesce(contact, nullif(v_contact, '')),
      phone   = coalesce(phone, nullif(v_phone, '')),
      notes   = v_enquiry || coalesce(E'\n\n---\n\n' || nullif(notes, ''), '')
    where id = v_lead.id;
  else
    select id into v_status_id from public.lead_statuses where name = 'Contact Page' limit 1;
    insert into public.leads (company, contact, email, phone, notes, source, lead_status_id)
    values (v_company, nullif(v_contact, ''), v_email, nullif(v_phone, ''), v_summary,
            'Web form: ' || v_form.name, v_status_id)
    returning * into v_lead;
  end if;

  select * into v_settings from public.company_settings where id = 1;
  v_ref := public.new_quote_reference(v_mode);
  insert into public.quotes (
    reference, client_id, lead_id, mode, commodity, origin, destination, incoterms,
    status, valid_until, fx_usd_zar, fx_cny_zar, fx_eur_zar, sales_person_id, enquiry_notes,
    commercial_value, value_currency, container_type,
    request_ready_date, request_pickup, request_delivery, request_notes, mode_to_advise
  ) values (
    v_ref,
    v_lead.promoted_client_id,
    case when v_lead.promoted_client_id is null then v_lead.id end,
    v_mode,
    nullif(btrim(d ->> 'commodity'), ''),
    nullif(v_origin, ''),
    nullif(v_dest, ''),
    coalesce(v_inco, v_settings.default_incoterm),
    'open',
    current_date + 14,
    coalesce(v_settings.default_fx_usd_zar, 18.50),
    coalesce(v_settings.default_fx_cny_zar, 2.60),
    coalesce(v_settings.default_fx_eur_zar, 20.00),
    v_lead.sales_person_id,
    v_enquiry,
    public.try_numeric(d ->> 'value'),
    case when upper(d ->> 'value_currency') in ('USD', 'ZAR', 'EUR', 'GBP', 'CNY') then upper(d ->> 'value_currency') else 'USD' end,
    nullif(btrim(d ->> 'containers'), ''),
    public.try_date(d ->> 'ready_date'),
    v_sender,
    v_receiver,
    nullif(btrim(d ->> 'notes'), ''),
    public.web_form_quote_mode(v_choice) is null
  )
  returning id into v_quote_id;

  -- The packing list, same rows as the Quote Builder's.
  for v_item in select * from jsonb_array_elements(coalesce(d -> 'packing', '[]')) limit 60 loop
    if coalesce(public.try_numeric(v_item ->> 'qty_ctns'), 0) > 0 then
      insert into public.packing_list_items (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
      values (
        v_quote_id, v_pos,
        coalesce(public.try_numeric(v_item ->> 'length_cm'), 0),
        coalesce(public.try_numeric(v_item ->> 'width_cm'), 0),
        coalesce(public.try_numeric(v_item ->> 'height_cm'), 0),
        coalesce(public.try_numeric(v_item ->> 'actual_kg'), 0),
        public.try_numeric(v_item ->> 'qty_ctns')
      );
      v_pos := v_pos + 1;
    end if;
  end loop;

  insert into public.web_form_submissions (form_id, lead_id, data, utm)
  values (
    v_form.id, v_lead.id, d,
    case when v_form.track_url_params then coalesce(p_utm, '{}'::jsonb) else '{}'::jsonb end
  );

  insert into public.ops_tasks (kind, title, body, priority, due_date, lead_id, quote_id, client_id)
  values (
    'task',
    'Quote website request: ' || v_company || ' · ' || v_ref,
    'Submitted via "' || v_form.name || '"'
      || E'\nEmail: ' || v_email
      || case when v_phone <> '' then E'\nPhone: ' || v_phone else '' end
      || E'\n' || v_summary,
    'high',
    current_date,
    v_lead.id,
    v_quote_id,
    v_lead.promoted_client_id
  );

  if v_form.notify_email is not null and v_form.notify_email <> '' then
    begin
      select * into v_cfg from private.follow_up_config where id = 1;
      if v_cfg.site_url is not null and v_cfg.site_url <> '' then
        perform net.http_post(
          url := v_cfg.site_url || '/api/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', v_cfg.cron_secret),
          body := jsonb_build_object(
            'to', jsonb_build_array(v_form.notify_email),
            'subject', 'Quote request from ' || v_form.name || ': ' || v_company || ' (' || v_ref || ')',
            'html', public.web_request_mail_html(
              'New quote request', v_form.name, v_company, v_contact, v_email, v_phone,
              v_cfg.site_url || '/quotes/' || v_quote_id, v_ref, v_summary),
            'text', 'Quote request: ' || v_company || ' <' || v_email || '>, quote ' || v_ref
              || ': ' || v_cfg.site_url || '/quotes/' || v_quote_id
          )
        );
      end if;
    exception when others then
      null;  -- notification is best-effort
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.submit_quote_request(uuid, jsonb, jsonb) to anon, authenticated;

-- submit_web_form as in 0178, with the new html.
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
  v_form      public.web_forms%rowtype;
  v_parsed    jsonb;
  v_company   text;
  v_contact   text;
  v_email     text;
  v_phone     text;
  v_notes     text;
  v_mode      text;
  v_lead      public.leads%rowtype;
  v_status_id uuid;
  v_settings  public.company_settings%rowtype;
  v_ref       text;
  v_quote_id  uuid;
  v_is_quote  boolean;
  v_enquiry   text;
  v_cfg       private.follow_up_config%rowtype;
begin
  select * into v_form from public.web_forms where id = p_id and active = true;
  if v_form.id is null then
    return jsonb_build_object('ok', false, 'error', 'Form not found');
  end if;

  v_parsed  := public.web_form_parse(v_form.fields, p_data);
  v_contact := coalesce(v_parsed->>'contact', '');
  v_email   := coalesce(v_parsed->>'email', '');
  v_phone   := coalesce(v_parsed->>'phone', '');
  v_notes   := coalesce(v_parsed->>'notes', '');
  v_mode    := coalesce(v_parsed->>'mode', 'Air Freight (AIR)');
  -- leads.company is NOT NULL -- fall back so a submission can't fail.
  v_company := coalesce(nullif(v_parsed->>'company', ''), nullif(v_contact, ''),
                        nullif(v_email, ''), 'Web form lead');

  v_enquiry := 'Web form "' || v_form.name || '", ' || to_char(now() at time zone 'Africa/Johannesburg', 'DD Mon YYYY HH24:MI')
    || case when v_notes <> '' then E'\n\n' || v_notes else '' end;

  -- Same email as an existing lead: one lead per enquirer, the new enquiry
  -- goes on top of its notes. Otherwise a new lead, "Contact Page" status.
  if v_email <> '' then
    select * into v_lead from public.leads
     where lower(email) = v_email
     order by created_at desc limit 1;
  end if;

  if v_lead.id is not null then
    update public.leads set
      contact = coalesce(contact, nullif(v_contact, '')),
      phone   = coalesce(phone, nullif(v_phone, '')),
      notes   = v_enquiry || coalesce(E'\n\n---\n\n' || nullif(notes, ''), '')
    where id = v_lead.id;
  else
    select id into v_status_id from public.lead_statuses where name = 'Contact Page' limit 1;
    insert into public.leads (company, contact, email, phone, notes, source, lead_status_id)
    values (
      v_company,
      nullif(v_contact, ''),
      nullif(v_email, ''),
      nullif(v_phone, ''),
      nullif(v_notes, ''),
      'Web form: ' || v_form.name,
      v_status_id
    )
    returning * into v_lead;
  end if;

  -- Only a form that collects shipment details makes a quote (0176); a
  -- plain contact enquiry is the lead + task below.
  v_is_quote := exists (
    select 1 from jsonb_array_elements(v_form.fields) f where f ->> 'mapTo' like 'quote\_%'
  );

  -- The enquiry as a New Lead quote, ready for charges. A lead already
  -- promoted to a customer gets the quote on the customer.
  if v_is_quote then
  select * into v_settings from public.company_settings where id = 1;
  v_ref := public.new_quote_reference(v_mode);
  insert into public.quotes (
    reference, client_id, lead_id, mode, commodity, origin, destination, incoterms,
    status, valid_until, fx_usd_zar, fx_cny_zar, fx_eur_zar, sales_person_id, enquiry_notes, mode_to_advise
  ) values (
    v_ref,
    v_lead.promoted_client_id,
    case when v_lead.promoted_client_id is null then v_lead.id end,
    v_mode,
    v_parsed->>'commodity',
    v_parsed->>'origin',
    v_parsed->>'destination',
    coalesce(v_parsed->>'incoterms', v_settings.default_incoterm),
    'open',
    current_date + 14,
    coalesce(v_settings.default_fx_usd_zar, 18.50),
    coalesce(v_settings.default_fx_cny_zar, 2.60),
    coalesce(v_settings.default_fx_eur_zar, 20.00),
    v_lead.sales_person_id,
    v_enquiry,
    v_parsed->>'mode' is null
  )
  returning id into v_quote_id;
  end if;

  insert into public.web_form_submissions (form_id, lead_id, data, utm)
  values (
    v_form.id,
    v_lead.id,
    coalesce(p_data, '{}'::jsonb),
    case when v_form.track_url_params then coalesce(p_utm, '{}'::jsonb) else '{}'::jsonb end
  );

  insert into public.ops_tasks (kind, title, body, priority, due_date, lead_id, quote_id, client_id)
  values (
    'task',
    case when v_is_quote then 'Quote web-form enquiry: ' || v_company || ' · ' || v_ref
         else 'New contact enquiry: ' || v_company end,
    'Submitted via "' || v_form.name || '"'
      || case when v_email <> '' then E'\nEmail: ' || v_email else '' end
      || case when v_phone <> '' then E'\nPhone: ' || v_phone else '' end
      || case when v_notes <> '' then E'\n' || v_notes else '' end,
    'high',
    current_date,
    v_lead.id,
    v_quote_id,
    v_lead.promoted_client_id
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
            'subject', 'New lead from ' || v_form.name || ': ' || v_company
              || coalesce(' (' || v_ref || ')', ''),
            'html', public.web_request_mail_html(
              case when v_quote_id is not null then 'New quote request' else 'New lead' end,
              v_form.name, v_company, v_contact, v_email, v_phone,
              case when v_quote_id is not null then v_cfg.site_url || '/quotes/' || v_quote_id end,
              v_ref, v_notes),
            'text', 'New lead: ' || v_company || ' <' || v_email || '>'
              || coalesce(', quote ' || v_ref || ': ' || v_cfg.site_url || '/quotes/' || v_quote_id, '')
          )
        );
      end if;
    exception when others then
      null;  -- notification is best-effort
    end;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.submit_web_form(uuid, jsonb, jsonb) to anon, authenticated;

-- Sender name: "ExPac Forwarding".
alter table public.company_settings alter column mail_sender_name set default 'ExPac Forwarding';
update public.company_settings set mail_sender_name = 'ExPac Forwarding'
 where mail_sender_name = 'EXPAC Forwarding';
