-- ============================================================
-- 0093  Web forms: auto-create an Opportunity with every Lead
-- ============================================================
-- submit_web_form() (0037) already turns a public submission into a Lead,
-- a raw submission record and a high-priority "New web-form lead" task.
-- It did not put the lead on the Opportunities pipeline -- staff had to
-- add it manually via "+ Add Opportunity". This makes every web-form
-- submission also land a card in the "New Lead" pipeline column
-- automatically (opportunities.status default is already 'new_lead'),
-- titled after the form so a quote-request landing page (e.g.
-- "China-South Africa Freight Quote") is identifiable at a glance.
--
-- Run in the Supabase SQL editor after 0092. Self-contained & idempotent
-- (CREATE OR REPLACE — safe to re-run).

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
begin
  select * into v_form from public.web_forms where id = p_id and active = true;
  if v_form.id is null then
    return jsonb_build_object('ok', false, 'error', 'Form not found');
  end if;

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

  -- leads.company is NOT NULL -- fall back so a submission can't fail.
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

  -- Every web-form lead is a sales opportunity worth tracking -- land it on
  -- the pipeline in "New Lead" straight away (status default = 'new_lead').
  insert into public.opportunities (title, lead_id)
  values (v_form.name, v_lead_id);

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
            'text', 'New lead: ' || v_company || ' <' || v_email || '>'
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
