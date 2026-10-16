-- ============================================================
-- 0178  Website quote requests: "Not sure" mode is flagged
-- ============================================================
-- A quote must have a mode, so a website request with "Not sure, please
-- advise" (0174) lands as Air Freight (AIR) and looked like a real Air
-- request. quotes.mode_to_advise marks those quotes so the Quotations list
-- and the Quote Builder say "Not sure, please advise" until the team picks
-- the mode.
--
--   1. quotes.mode_to_advise, backfilled from open website requests whose
--      enquiry says "...mode: Not sure".
--   2. submit_quote_request() (0174) and submit_web_form() (0176, the lane
--      pages) set it when the mode answer doesn't map to a mode.
--   3. Changing the quote's mode clears it (trigger); the Quote Builder can
--      also clear it to keep the current mode.
--
-- Run in the Supabase SQL editor after 0177. Self-contained & idempotent.

alter table public.quotes add column if not exists mode_to_advise boolean not null default false;

update public.quotes
   set mode_to_advise = true
 where status = 'open'
   and mode_to_advise = false
   and enquiry_notes ~* 'mode: *not sure';

create or replace function public.quotes_clear_mode_to_advise()
returns trigger language plpgsql as $$
begin
  if new.mode is distinct from old.mode then
    new.mode_to_advise := false;
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_clear_mode_to_advise on public.quotes;
create trigger quotes_clear_mode_to_advise
  before update of mode on public.quotes
  for each row execute function public.quotes_clear_mode_to_advise();

-- submit_quote_request as in 0174, plus mode_to_advise on the new quote.
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
            'html',
              '<p>A new quote request came in on <b>' || v_form.name || '</b>.</p>'
              || '<p>Company: ' || v_company
              || '<br>Email: ' || v_email
              || '<br>Phone: ' || coalesce(nullif(v_phone, ''), '-') || '</p>'
              || '<p><a href="' || v_cfg.site_url || '/quotes/' || v_quote_id || '">Open quote ' || v_ref || '</a></p>'
              || '<pre>' || v_summary || '</pre>',
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

-- submit_web_form as in 0176, plus mode_to_advise when no mode answer maps.
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
            'html',
              '<p>A new lead just submitted <b>' || v_form.name || '</b>.</p>'
              || '<p>Company: ' || v_company
              || '<br>Email: ' || coalesce(nullif(v_email, ''), '-')
              || '<br>Phone: ' || coalesce(nullif(v_phone, ''), '-') || '</p>'
              || coalesce('<p><a href="' || v_cfg.site_url || '/quotes/' || v_quote_id || '">Open quote '
              || v_ref || '</a></p>', '')
              || case when v_notes <> '' then '<pre>' || v_notes || '</pre>' else '' end,
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
