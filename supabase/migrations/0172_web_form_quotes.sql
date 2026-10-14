-- ============================================================
-- 0172  Web-form enquiries land as New Lead quotes; Opportunities retired
-- ============================================================
-- Until now a web-form submission (0037 / 0093 / 0095) made a Lead, an empty
-- Opportunity and a loose task, with every shipment answer only as text in
-- the lead notes, so each enquiry was retyped into a quote by hand. Quote
-- statuses already are the pipeline (New Lead / Quote Sent / Accepted /
-- Completed / Not Proceeding), so the Opportunity was a second record of
-- the same deal.
--
-- Now:
--   1. quotes.enquiry_notes: internal, never printed or shown on the portal,
--      the enquiry as submitted, shown at the top of the Quote Builder.
--   2. New form field targets (mapTo): quote_mode, quote_origin,
--      quote_destination, quote_incoterms, quote_commodity. Each still goes
--      into the lead notes / enquiry notes as before, and also fills that
--      quote field. The existing forms are switched over by field label.
--   3. submit_web_form(): reuses the lead with the same email (new enquiry
--      added on top of its notes) or makes a new one, then creates a
--      New Lead quote for it (auto reference AIR/SEA/CX/RDX + 6 digits,
--      FX + incoterm from Quote Defaults, the lead's sales person), and the
--      high-priority task links to the lead and the quote. No Opportunity.
--   4. Opportunities still New Lead / Quote Sent with no quote become quotes
--      (status open / sent) and are linked to them. Accepted / completed /
--      not proceeding ones are left as they are: they are the historical
--      sales that Trends counts, and an accepted quote would create a job.
--
-- Run in the Supabase SQL editor after 0171. Self-contained & idempotent.

-- 1. Internal enquiry notes on a quote --------------------------------------
alter table public.quotes add column if not exists enquiry_notes text;

-- 2. Helpers ----------------------------------------------------------------

-- A free-text / dropdown answer -> a quote mode, or null when unclear.
create or replace function public.web_form_quote_mode(p_val text)
returns text language sql immutable as $$
  select case
    when p_val ilike '%fcl%'                            then 'Sea Freight (FCL)'
    when p_val ilike '%lcl%'                            then 'Sea Freight (LCL)'
    when p_val ilike '%courier%' or p_val ilike '%(cx)%' then 'Courier Express (CX)'
    when p_val ilike '%road%'                           then 'Road Freight (RDX)'
    when p_val ilike '%air%'                            then 'Air Freight (AIR)'
    else null
  end;
$$;

-- Same shape as the Quote Builder's references (prefix + 6 digits), unique
-- across quotes and jobs (as portal_request_quote, 0141).
create or replace function public.new_quote_reference(p_mode text)
returns text language plpgsql volatile as $$
declare
  v_prefix text := case
    when p_mode ilike 'sea%'     then 'SEA'
    when p_mode ilike 'road%'    then 'RDX'
    when p_mode ilike 'courier%' then 'CX'
    else 'AIR'
  end;
  v_ref text;
begin
  loop
    v_ref := v_prefix || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.quotes where reference = v_ref)
          and not exists (select 1 from public.jobs where reference = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- One submission (form fields + answers) -> the lead's contact details, the
-- notes text (same layout as 0095) and the quote fields. Shared by
-- submit_web_form() and the Opportunity conversion below.
create or replace function public.web_form_parse(p_fields jsonb, p_data jsonb)
returns jsonb language plpgsql immutable as $$
declare
  v_field jsonb;
  v_map   text;
  v_val   text;
  v_label text;
  v_out   jsonb := '{}';
  v_notes text := '';
  v_inco  text;
begin
  for v_field in select * from jsonb_array_elements(coalesce(p_fields, '[]'))
  loop
    v_map   := coalesce(v_field->>'mapTo', 'none');
    v_val   := btrim(coalesce(p_data->>(v_field->>'id'), ''));
    v_label := coalesce(v_field->>'label', 'Field');
    if v_val = '' then
      continue;
    end if;

    if v_map = 'company' then
      v_out := v_out || jsonb_build_object('company', v_val);
    elsif v_map = 'contact' then
      v_out := v_out || jsonb_build_object('contact', v_val);
    elsif v_map = 'email' then
      v_out := v_out || jsonb_build_object('email', lower(v_val));
    elsif v_map = 'phone' then
      v_out := v_out || jsonb_build_object('phone', v_val);
    elsif v_map = 'quote_mode' then
      if public.web_form_quote_mode(v_val) is not null then
        v_out := v_out || jsonb_build_object('mode', public.web_form_quote_mode(v_val));
      end if;
    elsif v_map = 'quote_origin' then
      -- "Origin in China: Shenzhen" -> "Shenzhen, China" on the route forms.
      v_out := v_out || jsonb_build_object('origin',
        case when v_label ilike 'origin in %' and v_val not ilike ('%' || substr(v_label, 11) || '%')
             then v_val || ', ' || substr(v_label, 11)
             else v_val end);
    elsif v_map = 'quote_destination' then
      v_out := v_out || jsonb_build_object('destination', v_val);
    elsif v_map = 'quote_incoterms' then
      v_inco := upper(v_val);
      if v_inco in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP') then
        v_out := v_out || jsonb_build_object('incoterms', v_inco);
      end if;
    elsif v_map = 'quote_commodity' then
      v_out := v_out || jsonb_build_object('commodity', v_val);
    end if;

    -- Every answer that isn't a contact detail still goes into the notes.
    if v_map not in ('company', 'contact', 'email', 'phone', 'none') then
      if coalesce(v_field->>'type', '') = 'textarea' then
        v_notes := v_notes
          || case when v_notes = '' then '' else E'\n\n' end
          || v_label || ':' || E'\n' || v_val;
      else
        v_notes := v_notes
          || case when v_notes = '' then '' else E'\n' end
          || v_label || ': ' || v_val;
      end if;
    end if;
  end loop;
  return v_out || jsonb_build_object('notes', v_notes);
end;
$$;

-- 3. Existing forms: shipment answers fill the quote --------------------------
update public.web_forms f
set fields = (
  select jsonb_agg(
           case
             when coalesce(e.fld->>'mapTo', 'none') <> 'notes' then e.fld
             when e.fld->>'label' in ('Freight Mode', 'Service Required')
               then jsonb_set(e.fld, '{mapTo}', '"quote_mode"')
             when e.fld->>'label' ilike 'origin in %' or e.fld->>'label' = 'From'
               then jsonb_set(e.fld, '{mapTo}', '"quote_origin"')
             when e.fld->>'label' in ('Destination in South Africa', 'TO', 'To')
               then jsonb_set(e.fld, '{mapTo}', '"quote_destination"')
             when e.fld->>'label' in ('Incoterm', 'Incoterms')
               then jsonb_set(e.fld, '{mapTo}', '"quote_incoterms"')
             when e.fld->>'label' = 'Cargo Details'
               then jsonb_set(e.fld, '{mapTo}', '"quote_commodity"')
             else e.fld
           end
           order by e.ord)
  from jsonb_array_elements(f.fields) with ordinality as e(fld, ord)
)
where jsonb_typeof(f.fields) = 'array' and jsonb_array_length(f.fields) > 0;

-- 4. submit_web_form: lead (reused by email) + New Lead quote + task ---------
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

  -- The enquiry as a New Lead quote, ready for charges. A lead already
  -- promoted to a customer gets the quote on the customer.
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
    'Quote web-form enquiry: ' || v_company || ' · ' || v_ref,
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
            'subject', 'New lead from ' || v_form.name || ': ' || v_company || ' (' || v_ref || ')',
            'html',
              '<p>A new lead just submitted <b>' || v_form.name || '</b>.</p>'
              || '<p>Company: ' || v_company
              || '<br>Email: ' || coalesce(nullif(v_email, ''), '-')
              || '<br>Phone: ' || coalesce(nullif(v_phone, ''), '-') || '</p>'
              || '<p><a href="' || v_cfg.site_url || '/quotes/' || v_quote_id || '">Open quote '
              || v_ref || '</a></p>'
              || case when v_notes <> '' then '<pre>' || v_notes || '</pre>' else '' end,
            'text', 'New lead: ' || v_company || ' <' || v_email || '>, quote ' || v_ref
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
grant execute on function public.submit_web_form(uuid, jsonb, jsonb) to anon, authenticated;

-- 5. Open Opportunities with no quote -> quotes -------------------------------
do $$
declare
  o        record;
  v_sub    record;
  v_parsed jsonb;
  v_mode   text;
  v_qid    uuid;
  v_set    public.company_settings%rowtype;
  v_enq    text;
begin
  select * into v_set from public.company_settings where id = 1;
  for o in
    select op.*, l.notes as lead_notes, l.sales_person_id as lead_sp
      from public.opportunities op
      left join public.leads l on l.id = op.lead_id
     where op.quote_id is null
       and op.status in ('new_lead', 'quote_sent')
       and (op.lead_id is not null or op.client_id is not null)
     order by op.created_at
  loop
    -- The lead's latest web-form submission, if any, fills the quote fields.
    v_parsed := '{}';
    if o.lead_id is not null then
      select s.data, f.fields into v_sub
        from public.web_form_submissions s
        join public.web_forms f on f.id = s.form_id
       where s.lead_id = o.lead_id
       order by s.created_at desc limit 1;
      if found then
        v_parsed := public.web_form_parse(v_sub.fields, v_sub.data);
      end if;
    end if;
    v_mode := coalesce(v_parsed->>'mode', 'Air Freight (AIR)');
    v_enq := concat_ws(E'\n\n',
      'From Opportunity' || coalesce(' "' || nullif(o.title, '') || '"', '')
        || ', ' || to_char(o.created_at at time zone 'Africa/Johannesburg', 'DD Mon YYYY'),
      nullif(o.notes, ''),
      nullif(o.lead_notes, ''));

    insert into public.quotes (
      reference, client_id, lead_id, mode, commodity, origin, destination, incoterms,
      status, valid_until, fx_usd_zar, fx_cny_zar, fx_eur_zar, sales_person_id,
      opportunity_value, enquiry_notes, created_at
    ) values (
      public.new_quote_reference(v_mode),
      o.client_id,
      case when o.client_id is null then o.lead_id end,
      v_mode,
      v_parsed->>'commodity',
      v_parsed->>'origin',
      v_parsed->>'destination',
      coalesce(v_parsed->>'incoterms', v_set.default_incoterm),
      case when o.status = 'quote_sent' then 'sent' else 'open' end,
      current_date + 14,
      coalesce(v_set.default_fx_usd_zar, 18.50),
      coalesce(v_set.default_fx_cny_zar, 2.60),
      coalesce(v_set.default_fx_eur_zar, 20.00),
      coalesce(o.sales_person_id, o.lead_sp),
      nullif(o.value, 0),
      v_enq,
      o.created_at
    )
    returning id into v_qid;

    update public.opportunities set quote_id = v_qid, updated_at = now() where id = o.id;
  end loop;
end;
$$;
