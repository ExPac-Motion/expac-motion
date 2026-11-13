-- ============================================================
-- 0244  Partner Portal: dashboard, Quotes (RFQs) and email alerts
-- ============================================================
-- Follows 0243 (Shipments). For partner logins:
--   1. partner_shipments() also returns each shipment's live position
--      (vessel / port coordinates from job_tracking) for the dashboard map.
--   2. partner_rfqs(): the Requests for Quote ExPac sent this partner (0241),
--      their status, reply-by date, reply link and the rates they sent.
--      No customer, consignee or sell figures.
--   3. Email alerts to partners: assigned to a shipment, and ETD / ETA /
--      delivery date changes made by ExPac. Queued in partner_alerts and
--      sent every 5 minutes, one email per partner (pg_cron + pg_net through
--      /api/send-mail with the cron key, like the follow-up workflows).
--      Changes a partner makes themselves don't alert them.
--
-- Run in the Supabase SQL editor after 0243. Self-contained & idempotent.

-- ---------- 1. Shipment list with positions ----------
create or replace function public.partner_shipments()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'sort'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', j.id,
      'sort', case when j.ops_completed_at is null and btrim(coalesce(j.shipment_status, '')) <> 'Delivered' then '0' else '1' end
              || coalesce(j.eta::text, j.etd::text, '9999'),
      'reference', j.reference,
      'shipment_kind', j.shipment_kind,
      'master_reference', (select m.reference from public.jobs m where m.id = j.master_job_id),
      'mode', j.mode,
      'origin', j.origin,
      'destination', j.destination,
      'incoterms', q.incoterms,
      'shipment_status', j.shipment_status,
      'ready_date', q.request_ready_date,
      'etd', j.etd,
      'eta', j.eta,
      'delivery_date', j.provisional_delivery_date,
      'awb_mbl', case when public.my_partner_kind() = 'transporter' then null else j.awb_mbl end,
      'container_no', j.container_no,
      'vessel_name', case when public.my_partner_kind() = 'transporter' then null else j.vessel_name end,
      'tracking', (select jsonb_build_object('vessel_lat', t.vessel_lat, 'vessel_lon', t.vessel_lon, 'position_at', t.position_at,
                                             'pol_lat', t.pol_lat, 'pol_lon', t.pol_lon, 'pod_lat', t.pod_lat, 'pod_lon', t.pod_lon,
                                             'status', t.tracking_status)
                     from public.job_tracking t where t.job_id = coalesce(j.master_job_id, j.id)
                     order by t.synced_at desc nulls last limit 1),
      'completed', j.ops_completed_at is not null or btrim(coalesce(j.shipment_status, '')) = 'Delivered',
      'unread', (select count(*) from public.job_partner_messages m
                  where m.job_id = j.id and m.partner_id = public.my_partner_id()
                    and m.direction = 'out' and m.read_at is null),
      -- What this partner still has to do.
      'action', case public.my_partner_kind()
        when 'agent' then
          case when btrim(coalesce(j.shipment_status, '')) in ('', 'Created')
                 then 'Confirm the booking'
               when j.awb_mbl is null or j.etd is null
                 then 'Booking details missing'
          end
        when 'transporter' then
          case when btrim(coalesce(j.shipment_status, '')) = 'Delivered' and j.pod_delivered_at is null
                 then 'Upload the POD'
               when btrim(coalesce(j.shipment_status, '')) = 'Released'
                 then 'Ready for delivery'
          end
        when 'destination_agent' then
          case when btrim(coalesce(j.shipment_status, '')) = 'Delivered' and j.pod_delivered_at is null
                 then 'Upload the POD'
          end
      end
    ) as x
    from public.jobs j
    left join public.quotes q on q.id = j.quote_id
    where j.id in (select public.partner_job_ids())
      and (j.ops_completed_at is null or j.ops_completed_at > now() - interval '60 days')
  ) s;
$$;
revoke execute on function public.partner_shipments() from public, anon;
grant execute on function public.partner_shipments() to authenticated;

-- ---------- 2. The partner's Requests for Quote ----------
-- The partner's own email (an RFQ sent to a typed-in address still counts).
create or replace function public.my_partner_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(btrim(coalesce(
    case public.my_partner_kind()
      when 'agent' then (select a.email from public.agents a where a.id = public.my_partner_id())
      when 'transporter' then (select t.email from public.transporters t where t.id = public.my_partner_id())
      when 'clearing_agent' then (select c.email from public.clearing_agents c where c.id = public.my_partner_id())
      when 'destination_agent' then (select d.email from public.destination_agents d where d.id = public.my_partner_id())
    end, '')));
$$;
revoke execute on function public.my_partner_email() from public, anon;
grant execute on function public.my_partner_email() to authenticated;

create or replace function public.partner_rfqs()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x ->> 'sort' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id,
      'sort', coalesce(r.sent_at, f.created_at)::text,
      'token', r.token,
      'rfq_number', 'RFQ-' || q.reference,
      'reference', q.reference,
      'mode', q.mode,
      'origin', q.origin,
      'destination', q.destination,
      'incoterms', q.incoterms,
      'reply_by', f.reply_by,
      'sent_at', coalesce(r.sent_at, f.created_at),
      'status', r.status,
      'responded_at', r.responded_at,
      'validity', r.validity,
      'transit_time', r.transit_time,
      'remarks', r.remarks,
      'rates', coalesce((
        select jsonb_agg(jsonb_build_object('code', rr.code, 'description', rr.description, 'unit', rr.unit,
                                            'cur', rr.cur, 'rate', rr.rate, 'min_charge', rr.min_charge, 'remarks', rr.remarks)
                         order by rr.position)
          from public.quote_rfq_rates rr where rr.recipient_id = r.id), '[]'::jsonb)
    ) as x
    from public.quote_rfq_recipients r
    join public.quote_rfqs f on f.id = r.rfq_id
    join public.quotes q on q.id = f.quote_id
    where public.my_partner_id() is not null
      and f.partner_kind = public.my_partner_kind()
      and (r.partner_id = public.my_partner_id()
           or (r.partner_id is null and public.my_partner_email() <> '' and lower(btrim(r.email)) = public.my_partner_email()))
      and coalesce(r.sent_at, f.created_at) > now() - interval '120 days'
  ) s;
$$;
revoke execute on function public.partner_rfqs() from public, anon;
grant execute on function public.partner_rfqs() to authenticated;

-- ---------- 3. Email alerts ----------
create table if not exists public.partner_alerts (
  id            uuid primary key default gen_random_uuid(),
  partner_kind  text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id    uuid not null,
  job_id        uuid not null references public.jobs (id) on delete cascade,
  kind          text not null check (kind in ('assigned', 'dates')),
  detail        text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists partner_alerts_unsent_idx on public.partner_alerts (created_at) where sent_at is null;

alter table public.partner_alerts enable row level security;
drop policy if exists "team read" on public.partner_alerts;
create policy "team read" on public.partner_alerts
  for select to authenticated using (public.is_staff());

-- The partners on a job (same rule as partner_job_ids, seen from the job).
create or replace function public.job_partner_list(p_job uuid)
returns table (partner_kind text, partner_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  q public.quotes%rowtype;
  ca uuid;
begin
  select * into j from public.jobs where id = p_job;
  if not found then
    return;
  end if;
  select * into q from public.quotes
   where id = coalesce(j.quote_id, (select m.quote_id from public.jobs m where m.id = j.master_job_id));
  select c.clearing_agent_id into ca from public.customs_files c
   where c.job_id in (j.id, coalesce(j.master_job_id, j.id)) and c.clearing_agent_id is not null
   order by c.created_at desc limit 1;
  if q.agent_id is not null then
    partner_kind := 'agent'; partner_id := q.agent_id; return next;
  end if;
  if q.transporter_id is not null then
    partner_kind := 'transporter'; partner_id := q.transporter_id; return next;
  end if;
  if q.destination_agent_id is not null then
    partner_kind := 'destination_agent'; partner_id := q.destination_agent_id; return next;
  end if;
  if coalesce(ca, q.clearing_agent_id) is not null then
    partner_kind := 'clearing_agent'; partner_id := coalesce(ca, q.clearing_agent_id); return next;
  end if;
end;
$$;
revoke execute on function public.job_partner_list(uuid) from public, anon, authenticated;

-- New shipment: every partner on it is told once.
create or replace function public.partner_alert_on_job_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.partner_alerts (partner_kind, partner_id, job_id, kind)
  select l.partner_kind, l.partner_id, new.id, 'assigned' from public.job_partner_list(new.id) l;
  return null;
exception when others then
  return null;  -- alerts never block a shipment
end;
$$;
drop trigger if exists trg_partner_alert_job_insert on public.jobs;
create trigger trg_partner_alert_job_insert after insert on public.jobs
  for each row execute function public.partner_alert_on_job_insert();

-- Dates moved by ExPac (not by the partner itself).
create or replace function public.partner_alert_on_job_dates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parts text[] := '{}';
  me uuid := public.my_partner_id();
begin
  if new.ops_completed_at is not null then
    return null;
  end if;
  if new.etd is distinct from old.etd then
    parts := parts || ('ETD ' || coalesce(to_char(old.etd, 'DD/MM/YYYY'), '-') || ' to ' || coalesce(to_char(new.etd, 'DD/MM/YYYY'), '-'));
  end if;
  if new.eta is distinct from old.eta then
    parts := parts || ('ETA ' || coalesce(to_char(old.eta, 'DD/MM/YYYY'), '-') || ' to ' || coalesce(to_char(new.eta, 'DD/MM/YYYY'), '-'));
  end if;
  if new.provisional_delivery_date is distinct from old.provisional_delivery_date then
    parts := parts || ('Delivery date ' || coalesce(to_char(old.provisional_delivery_date, 'DD/MM/YYYY'), '-')
                       || ' to ' || coalesce(to_char(new.provisional_delivery_date, 'DD/MM/YYYY'), '-'));
  end if;
  if cardinality(parts) = 0 then
    return null;
  end if;
  insert into public.partner_alerts (partner_kind, partner_id, job_id, kind, detail)
  select l.partner_kind, l.partner_id, new.id, 'dates', array_to_string(parts, ', ')
    from public.job_partner_list(new.id) l
   where me is null or l.partner_id <> me;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists trg_partner_alert_job_dates on public.jobs;
create trigger trg_partner_alert_job_dates after update of etd, eta, provisional_delivery_date on public.jobs
  for each row execute function public.partner_alert_on_job_dates();

-- A partner added to a quote that already has its shipment.
create or replace function public.partner_alert_on_quote_partner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jid uuid;
begin
  for jid in select id from public.jobs where quote_id = new.id and ops_completed_at is null loop
    if new.agent_id is not null and new.agent_id is distinct from old.agent_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('agent', new.agent_id, jid, 'assigned');
    end if;
    if new.transporter_id is not null and new.transporter_id is distinct from old.transporter_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('transporter', new.transporter_id, jid, 'assigned');
    end if;
    if new.destination_agent_id is not null and new.destination_agent_id is distinct from old.destination_agent_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('destination_agent', new.destination_agent_id, jid, 'assigned');
    end if;
    if new.clearing_agent_id is not null and new.clearing_agent_id is distinct from old.clearing_agent_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('clearing_agent', new.clearing_agent_id, jid, 'assigned');
    end if;
  end loop;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists trg_partner_alert_quote_partner on public.quotes;
create trigger trg_partner_alert_quote_partner
  after update of agent_id, transporter_id, destination_agent_id, clearing_agent_id on public.quotes
  for each row execute function public.partner_alert_on_quote_partner();

-- Send: alerts at least 2 minutes old (so a burst of edits makes one email),
-- one email per partner listing every shipment.
create or replace function public.partner_alerts_send()
returns integer language plpgsql security definer set search_path = public as $$
declare
  cfg record;
  grp record;
  v_email text;
  v_company text;
  v_login boolean;
  rows_html text;
  rows_text text;
  font constant text := 'font-family:Aptos,''Aptos Display'',Calibri,''Segoe UI'',Helvetica,Arial,sans-serif;';
  sent int := 0;
begin
  select * into cfg from private.follow_up_config where id = 1;
  if cfg.site_url is null or cfg.site_url = '' or cfg.cron_secret = '' then
    return 0;
  end if;

  for grp in
    select a.partner_kind, a.partner_id, array_agg(a.id) as ids
      from public.partner_alerts a
     where a.sent_at is null and a.created_at < now() - interval '2 minutes'
     group by a.partner_kind, a.partner_id
  loop
    v_email := null;
    v_company := null;
    if grp.partner_kind = 'agent' then
      select email, company into v_email, v_company from public.agents where id = grp.partner_id;
    elsif grp.partner_kind = 'transporter' then
      select email, company into v_email, v_company from public.transporters where id = grp.partner_id;
    elsif grp.partner_kind = 'clearing_agent' then
      select email, company into v_email, v_company from public.clearing_agents where id = grp.partner_id;
    else
      select email, company into v_email, v_company from public.destination_agents where id = grp.partner_id;
    end if;
    v_login := exists (select 1 from public.profiles p where p.role = 'partner' and p.partner_id = grp.partner_id);

    if coalesce(btrim(v_email), '') <> '' then
      select string_agg(
               '<tr><td style="padding:6px 14px 6px 0;font-weight:bold;color:#202426;">' || public.mail_esc(j.reference) || '</td>'
               || '<td style="padding:6px 14px 6px 0;color:#202426;">' || public.mail_esc(coalesce(j.origin, '-') || ' to ' || coalesce(j.destination, '-')) || '</td>'
               || '<td style="padding:6px 0;color:#202426;">'
               || case a.kind
                    when 'assigned' then 'New shipment for you'
                                         || coalesce(', ETD ' || to_char(j.etd, 'DD/MM/YYYY'), '')
                                         || coalesce(', ETA ' || to_char(j.eta, 'DD/MM/YYYY'), '')
                    else public.mail_esc(coalesce(a.detail, 'Dates changed')) end
               || '</td></tr>', '' order by a.created_at),
             string_agg(j.reference || ': ' || case a.kind when 'assigned' then 'new shipment for you' else coalesce(a.detail, 'dates changed') end,
                        E'\n' order by a.created_at)
        into rows_html, rows_text
        from public.partner_alerts a join public.jobs j on j.id = a.job_id
       where a.id = any (grp.ids);

      begin
        perform net.http_post(
          url := cfg.site_url || '/api/send-mail',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', cfg.cron_secret),
          body := jsonb_build_object(
            'to', jsonb_build_array(btrim(v_email)),
            'subject', 'ExPac shipment update for ' || coalesce(v_company, 'you'),
            'fromName', 'ExPac Forwarding',
            'html',
              '<div style="' || font || 'font-size:11pt;color:#202426;">'
              || '<p>Good day,</p><p>Here is what changed on your ExPac shipments:</p>'
              || '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;' || font || 'font-size:11pt;">' || rows_html || '</table>'
              || case when v_login
                   then '<p style="margin-top:16px;"><a href="' || cfg.site_url || '/partner" style="display:inline-block;background:#719d2f;color:#ffffff;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:6px;">Open the Partner Portal</a></p>'
                   else '<p>Reply to this email if anything needs our attention.</p>' end
              || '<p>Kind regards,<br>ExPac Forwarding</p></div>',
            'text', 'Here is what changed on your ExPac shipments:' || E'\n\n' || rows_text
              || case when v_login then E'\n\nPartner Portal: ' || cfg.site_url || '/partner' else '' end
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

do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, partner alerts will queue but not send';
    return;
  end if;
  perform cron.unschedule(jobname) from cron.job where jobname = 'partner-alerts';
  perform cron.schedule('partner-alerts', '*/5 * * * *', 'select public.partner_alerts_send()');
end $$;

notify pgrst, 'reload schema';
