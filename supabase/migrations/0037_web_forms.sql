-- ============================================================
-- 0037  Sales CRM: Web contact forms
-- ============================================================
-- Build a contact form here, embed it on the public website. A visitor
-- submission (anon) creates a Lead, records the raw submission, and
-- raises a high-priority ops task so the team sees "new lead signed up".
-- If the form has a notify email set, it also fires an email through the
-- same /api/send-mail path the follow-up worker uses (pg_net + CRON_SECRET,
-- best-effort -- a failed notification never fails a submission).
--
-- Run in the Supabase SQL editor after 0035. Self-contained & idempotent.

create table if not exists public.web_forms (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'Untitled form',
  heading          text not null default 'Contact Us',
  subtitle         text not null default '',
  fields           jsonb not null default '[]',
  submit_label     text not null default 'Submit',
  thankyou_title   text not null default 'Thank you!',
  thankyou_body    text not null default 'Your submission has been received. We will get back to you shortly.',
  notify_email     text,
  track_url_params boolean not null default false,
  active           boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.web_form_submissions (
  id         uuid primary key default gen_random_uuid(),
  form_id    uuid references public.web_forms (id) on delete cascade,
  lead_id    uuid references public.leads (id) on delete set null,
  data       jsonb not null default '{}',
  utm        jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists web_form_submissions_form_idx
  on public.web_form_submissions (form_id, created_at desc);

alter table public.web_forms enable row level security;
drop policy if exists "team full access" on public.web_forms;
create policy "team full access" on public.web_forms
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.web_form_submissions enable row level security;
drop policy if exists "team full access" on public.web_form_submissions;
create policy "team full access" on public.web_form_submissions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Public read of just the render-safe columns (no notify_email leak).
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
    'track_url_params', track_url_params
  )
  from public.web_forms
  where id = p_id and active = true;
$$;
grant execute on function public.get_web_form(uuid) to anon, authenticated;

-- Public submission: answers -> Lead (+ raw submission + team alert + optional email).
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
