-- ============================================================
-- 0174  Website quote request: the trade-lane forms build a full quote
-- ============================================================
-- The expac.co.za trade-lane pages (China / Europe / India / UK / US to
-- South Africa) and Contact Us send a web form into Motion. Since 0172 that
-- makes a New Lead quote with mode / route / incoterms, but the cargo was
-- free text. A form can now be a "quote request": the hosted form at
-- /forms/<id> shows the same inputs as the Quote Builder (mode, route,
-- incoterms, cargo ready date, sender, receiver and a real packing list),
-- and submit_quote_request() lands it as a New Lead quote with its packing
-- list, collection (sender) and delivery (receiver) details, ready date and
-- the whole enquiry, ready for charges.
--
--   1. web_forms.kind ('fields' = the field builder as before, or
--      'quote_request') and lane_origin_country (e.g. 'China': the origin
--      field asks for a city in China and the quote's origin gets ", China").
--      The route forms + Contact Us switch to quote_request.
--   2. get_web_form() also returns kind / lane_origin_country.
--   3. submit_quote_request(): lead (reused by email, as 0172), quote,
--      packing_list_items, submission record, high-priority task, the
--      form's notification email. A filled-in hidden "website" field
--      (bots) is accepted and dropped; more than 5 requests from one email
--      in 10 minutes are refused.
--   submit_web_form() (0172) is unchanged, so anything still posting the
--   old fields keeps working.
--
-- Run in the Supabase SQL editor after 0173. Self-contained & idempotent.

-- 1. Form type + lane ---------------------------------------------------------
alter table public.web_forms
  add column if not exists kind text not null default 'fields',
  add column if not exists lane_origin_country text;

alter table public.web_forms drop constraint if exists web_forms_kind_check;
alter table public.web_forms
  add constraint web_forms_kind_check check (kind in ('fields', 'quote_request'));

-- "China-South Africa Route" -> quote request, origin country China.
update public.web_forms
set kind = 'quote_request',
    lane_origin_country = btrim(split_part(name, '-South Africa', 1))
where name ilike '%-South Africa Route%' and kind = 'fields';

update public.web_forms
set kind = 'quote_request'
where name ilike 'Contact Us%' and kind = 'fields';

-- 2. Public read ---------------------------------------------------------------
create or replace function public.get_web_form(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', id,
    'heading', heading,
    'subtitle', subtitle,
    'fields', fields,
    'submit_label', submit_label,
    'thankyou_title', thankyou_title,
    'thankyou_body', thankyou_body,
    'track_url_params', track_url_params,
    'kind', kind,
    'lane_origin_country', lane_origin_country
  )
  from public.web_forms
  where id = p_id and active = true;
$$;
grant execute on function public.get_web_form(uuid) to anon, authenticated;

-- 3. Submit ----------------------------------------------------------------------

-- A number typed on a public form: null instead of an error when it isn't one.
create or replace function public.try_numeric(p text)
returns numeric language plpgsql immutable as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.try_date(p text)
returns date language plpgsql immutable as $$
begin
  return nullif(btrim(coalesce(p, '')), '')::date;
exception when others then
  return null;
end;
$$;

-- A sender / receiver block as text lines (company, contact, phone, email, address).
create or replace function public.web_party_text(p jsonb)
returns text language sql immutable as $$
  select nullif(concat_ws(E'\n',
    nullif(btrim(p ->> 'company'), ''),
    nullif(concat_ws(', ',
      nullif(btrim(p ->> 'contact'), ''),
      nullif(btrim(p ->> 'phone'), ''),
      nullif(btrim(p ->> 'email'), '')), ''),
    nullif(btrim(p ->> 'address'), '')), '');
$$;

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
    request_ready_date, request_pickup, request_delivery, request_notes
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
    nullif(btrim(d ->> 'notes'), '')
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
