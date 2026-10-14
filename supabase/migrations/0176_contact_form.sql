-- ============================================================
-- 0176  Contact Us is a contact form again; enquiries don't make quotes
-- ============================================================
-- 0174 switched both Contact Us forms to the quote request layout; they
-- are general enquiry forms (quote requests have their own lane pages).
-- And since 0172 every submit_web_form() submission also made a New Lead
-- quote, a contact enquiry included.
--
--   1. "Contact Us" / "Contact Us (WP)": back to a contact form with
--      Full Name, Company Name, Email Address, Phone Number and Enquiry.
--   2. submit_web_form() makes the New Lead quote only for a form that
--      collects shipment details (a field mapped to Quote · Mode / Origin /
--      Destination / Incoterms / Commodity). A plain enquiry makes the lead
--      (reused by email, as before) and a "New contact enquiry" task linked
--      to it, plus the notification email.
--
-- Run in the Supabase SQL editor after 0175. Self-contained & idempotent.

update public.web_forms
set kind = 'fields',
    lane_origin_country = null,
    fields = '[
      {"id": "f_name",    "type": "text",     "label": "Full Name",     "required": true,  "mapTo": "contact"},
      {"id": "f_company", "type": "text",     "label": "Company Name",  "required": false, "mapTo": "company"},
      {"id": "f_email",   "type": "email",    "label": "Email Address", "required": true,  "mapTo": "email"},
      {"id": "f_phone",   "type": "phone",    "label": "Phone Number",  "required": false, "mapTo": "phone"},
      {"id": "f_enquiry", "type": "textarea", "label": "Enquiry",       "required": true,  "mapTo": "notes"}
    ]'::jsonb,
    updated_at = now()
where name ilike 'Contact Us%';

-- submit_web_form as in 0172, with the quote only for shipment forms.
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
    status, valid_until, fx_usd_zar, fx_cny_zar, fx_eur_zar, sales_person_id, enquiry_notes
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
    v_enquiry
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
