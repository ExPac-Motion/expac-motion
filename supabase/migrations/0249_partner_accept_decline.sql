-- ============================================================
-- 0249  Partner Portal: accept or decline a job handed over
-- ============================================================
-- A partner (agent / transporter / clearing agent / destination agent)
-- now accepts each shipment ExPac hands them before working on it, or
-- declines it with a reason:
--   * accepted: they can update milestones, upload and message;
--   * declined: that partner is cleared from the quote (the job leaves
--     their portal) and ExPac gets a high-priority Control Tower task to
--     pick another partner.
-- Until they accept, partner_shipment() returns the summary only (no
-- documents, messages, pickup / delivery contacts) and the database
-- refuses their updates, uploads and messages.
--
-- Every job a partner can see today is backfilled as accepted, so work
-- already under way is not blocked; jobs handed over from now on start
-- pending. A house counts as accepted when its master is.
-- Clearing agents' Customs Files (Broker Desk, 0232) are not gated.
--
-- Run in the Supabase SQL editor after 0248. Self-contained & idempotent.

-- ---------- 1. Table ----------
create table if not exists public.job_partner_assignments (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  partner_kind  text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id    uuid not null,
  status        text not null check (status in ('accepted', 'declined')),
  reason        text,
  responded_at  timestamptz not null default now(),
  responded_by  uuid references auth.users (id) on delete set null default auth.uid(),
  unique (job_id, partner_kind, partner_id)
);
create index if not exists job_partner_assignments_job_idx on public.job_partner_assignments (job_id);
alter table public.job_partner_assignments enable row level security;
drop policy if exists "team full access" on public.job_partner_assignments;
create policy "team full access" on public.job_partner_assignments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 2. Backfill: what partners can see today counts as accepted ----------
insert into public.job_partner_assignments (job_id, partner_kind, partner_id, status, reason, responded_by)
select x.job_id, x.kind, x.pid, 'accepted', 'Assigned before accept / decline existed', null
  from (
    select j.id as job_id, 'agent' as kind, q.agent_id as pid
      from public.jobs j join public.quotes q on q.id = j.quote_id where q.agent_id is not null
    union
    select j.id, 'transporter', q.transporter_id
      from public.jobs j join public.quotes q on q.id = j.quote_id where q.transporter_id is not null
    union
    select j.id, 'destination_agent', q.destination_agent_id
      from public.jobs j join public.quotes q on q.id = j.quote_id where q.destination_agent_id is not null
    union
    select j.id, 'clearing_agent', q.clearing_agent_id
      from public.jobs j join public.quotes q on q.id = j.quote_id where q.clearing_agent_id is not null
    union
    select cf.job_id, 'clearing_agent', cf.clearing_agent_id
      from public.customs_files cf where cf.clearing_agent_id is not null
  ) x
on conflict (job_id, partner_kind, partner_id) do nothing;

-- ---------- 3. Has the signed-in partner accepted this job? ----------
create or replace function public.partner_acceptance(p_job uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when exists (
           select 1 from public.job_partner_assignments a
            where a.partner_kind = public.my_partner_kind()
              and a.partner_id = public.my_partner_id()
              and a.status = 'accepted'
              and a.job_id in (p_job, (select j.master_job_id from public.jobs j where j.id = p_job)))
         then 'accepted' else 'pending' end;
$$;
revoke execute on function public.partner_acceptance(uuid) from public, anon;
grant execute on function public.partner_acceptance(uuid) to authenticated;

-- All of my visible jobs with their acceptance (the list merges this in).
create or replace function public.partner_acceptances()
returns table (job_id uuid, acceptance text) language sql stable security definer set search_path = public as $$
  select x, public.partner_acceptance(x) from public.partner_job_ids() x;
$$;
revoke execute on function public.partner_acceptances() from public, anon;
grant execute on function public.partner_acceptances() to authenticated;

-- ---------- 4. Accept / decline ----------
create or replace function public.partner_respond(p_job uuid, p_accept boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  who text := coalesce(public.partner_company_name(), 'Partner');
  j public.jobs%rowtype;
  qid uuid;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  select * into j from public.jobs where id = p_job;
  qid := coalesce(j.quote_id, (select m.quote_id from public.jobs m where m.id = j.master_job_id));

  if p_accept then
    insert into public.job_partner_assignments (job_id, partner_kind, partner_id, status, reason)
    values (p_job, k, p, 'accepted', why)
    on conflict (job_id, partner_kind, partner_id)
      do update set status = 'accepted', reason = excluded.reason, responded_at = now(), responded_by = auth.uid();
    insert into public.job_events (job_id, milestone, note, created_by)
    values (p_job, j.milestone, who || ' accepted the shipment' || coalesce(': ' || why, ''), auth.uid());
    perform public.partner_task_for_expac(p_job, who || ' accepted the shipment',
      coalesce(why, 'Accepted on the partner portal.'), 'normal');
  else
    if why is null then
      raise exception 'Tell ExPac why you are declining';
    end if;
    insert into public.job_partner_assignments (job_id, partner_kind, partner_id, status, reason)
    values (p_job, k, p, 'declined', why)
    on conflict (job_id, partner_kind, partner_id)
      do update set status = 'declined', reason = excluded.reason, responded_at = now(), responded_by = auth.uid();
    insert into public.job_events (job_id, milestone, note, created_by)
    values (p_job, j.milestone, who || ' declined the shipment: ' || why, auth.uid());
    perform public.partner_task_for_expac(p_job, who || ' declined the shipment',
      'Reason: ' || why || E'\nPick another ' || replace(k, '_', ' ') || ' on the quote.', 'high');
    -- Back to ExPac: clear this partner from the quote.
    if k = 'agent' then
      update public.quotes set agent_id = null where id = qid and agent_id = p;
    elsif k = 'transporter' then
      update public.quotes set transporter_id = null where id = qid and transporter_id = p;
    elsif k = 'destination_agent' then
      update public.quotes set destination_agent_id = null where id = qid and destination_agent_id = p;
    elsif k = 'clearing_agent' then
      update public.quotes set clearing_agent_id = null where id = qid and clearing_agent_id = p;
    end if;
  end if;
end;
$$;
revoke execute on function public.partner_respond(uuid, boolean, text) from public, anon;
grant execute on function public.partner_respond(uuid, boolean, text) to authenticated;

-- ---------- 5. Nothing happens on a job until it is accepted ----------
create or replace function public.partner_require_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  jid uuid;
begin
  if k is null then return new; end if;  -- staff, customers, cron
  if tg_table_name = 'jobs' then
    if k = 'clearing_agent' then return new; end if;  -- Broker Desk updates
    jid := new.id;
  elsif tg_table_name = 'shipment_documents' then
    if new.from_partner_id is null then return new; end if;
    jid := new.job_id;
  elsif tg_table_name = 'job_partner_messages' then
    if new.direction <> 'in' then return new; end if;
    jid := new.job_id;
  else
    return new;
  end if;
  if public.partner_acceptance(jid) <> 'accepted' then
    raise exception 'Accept this shipment first';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_partner_accepted_jobs on public.jobs;
create trigger trg_partner_accepted_jobs before update on public.jobs
  for each row execute function public.partner_require_accepted();
drop trigger if exists trg_partner_accepted_docs on public.shipment_documents;
create trigger trg_partner_accepted_docs before insert on public.shipment_documents
  for each row execute function public.partner_require_accepted();
drop trigger if exists trg_partner_accepted_msgs on public.job_partner_messages;
create trigger trg_partner_accepted_msgs before insert on public.job_partner_messages
  for each row execute function public.partner_require_accepted();

-- ---------- 6. One shipment: summary only until accepted ----------
-- Re-emitted from 0248 (unchanged) apart from the acceptance block at the end.
create or replace function public.partner_shipment(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  j public.jobs%rowtype;
  q public.quotes%rowtype;
  qid uuid;
  sup public.suppliers%rowtype;
  con public.clients%rowtype;
  cf public.customs_files%rowtype;
  res jsonb;
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  select * into j from public.jobs where id = p_job;
  -- A house without its own quote reads the master's.
  qid := coalesce(j.quote_id, (select m.quote_id from public.jobs m where m.id = j.master_job_id));
  select * into q from public.quotes where id = qid;
  select * into cf from public.customs_files where job_id = coalesce(j.master_job_id, j.id) order by created_at desc limit 1;

  res := jsonb_build_object(
    'id', j.id,
    'partner_kind', k,
    'reference', j.reference,
    'shipment_kind', j.shipment_kind,
    'master_reference', (select m.reference from public.jobs m where m.id = j.master_job_id),
    'mode', j.mode,
    'origin', j.origin,
    'destination', j.destination,
    'incoterms', q.incoterms,
    'delivery_terms', q.delivery_terms,
    'commodity', q.commodity,
    'container_type', coalesce(j.container_type, q.container_type),
    'shipment_status', j.shipment_status,
    'ready_date', q.request_ready_date,
    'etd', j.etd,
    'eta', j.eta,
    'delivery_date', j.provisional_delivery_date,
    'carrier_name', j.carrier_name,
    'shipping_line', j.shipping_line,
    'vessel_name', j.vessel_name,
    'voyage_no', j.voyage_no,
    'awb_mbl', j.awb_mbl,
    'container_no', j.container_no,
    'seal_no', j.seal_no,
    'pod_signed_by', j.pod_signed_by,
    'pod_delivered_at', j.pod_delivered_at,
    'completed', j.ops_completed_at is not null or btrim(coalesce(j.shipment_status, '')) = 'Delivered',
    'notes', q.request_notes
  );

  -- Transporters see the dates and the release, not the booking details.
  if k = 'transporter' then
    res := res - 'carrier_name' - 'shipping_line' - 'vessel_name' - 'voyage_no' - 'awb_mbl' - 'seal_no';
  end if;

  -- Customs stage for those who need it.
  if k in ('clearing_agent', 'destination_agent', 'transporter') and cf.id is not null then
    res := res || jsonb_build_object(
      'customs_stage', cf.stage,
      'customs_released', cf.stage = 'cleared' or btrim(coalesce(j.shipment_status, '')) in ('Released', 'On-Delivery', 'Delivered'),
      'entry_no', case when k = 'transporter' then null else cf.entry_no end);
  end if;

  -- Origin agent: the shipper and the pickup address.
  if k = 'agent' then
    select * into sup from public.suppliers where id = coalesce(j.supplier_id, q.supplier_id);
    res := res || jsonb_build_object('pickup', jsonb_build_object(
      'company', sup.company,
      'address', coalesce(nullif(btrim(coalesce(q.request_pickup, '')), ''), sup.address),
      'contact', sup.contact, 'phone', sup.phone, 'email', sup.email));
  end if;

  -- Delivery side: the address and the on-site contact, never the company.
  if k in ('transporter', 'destination_agent', 'clearing_agent') then
    select * into con from public.clients where id = q.consignee_id;
    res := res || jsonb_build_object('delivery', jsonb_build_object(
      'address', coalesce(nullif(btrim(coalesce(q.request_delivery, '')), ''), con.address),
      'contact', con.contact, 'phone', con.phone));
  end if;

  res := res || jsonb_build_object(
    'packing', coalesce((
      select jsonb_agg(jsonb_build_object('length_cm', pk.length_cm, 'width_cm', pk.width_cm, 'height_cm', pk.height_cm,
                                          'actual_kg', pk.actual_kg, 'qty_pcs', pk.qty_pcs, 'qty_ctns', pk.qty_ctns, 'cbm', pk.cbm)
                       order by pk.position)
        from public.packing_list_items pk where pk.quote_id = qid), '[]'::jsonb),

    -- Their own buy lines (in the line's currency), as on our rate sheet to them.
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object('category', l.category, 'code', l.code, 'description', l.description,
                                          'unit', l.unit, 'cur', l.cur, 'rate', l.buy,
                                          'qty', l.qty)
                       order by l.position)
        from public.quote_lines l
       where l.quote_id = qid and coalesce(l.buy, 0) > 0
         and case
               when l.category = 'Destination Handling and Delivery Charges' and coalesce(l.code, '') ~ '^(TR|WH)-' then 'transporter'
               when l.category in ('International Freight Charges', 'Ex-Works Charges', 'FOB Charges') then 'agent'
               when l.category = 'Destination Handling and Delivery Charges' then 'destination_agent'
               when l.category = 'Customs Clearance, VAT and Duty Charges' then 'clearing_agent'
             end = k), '[]'::jsonb),

    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'doc_type', d.doc_type, 'storage_path', d.storage_path,
                                          'size_bytes', d.size_bytes, 'created_at', d.created_at,
                                          'mine', d.from_partner_id = p)
                       order by d.created_at)
        from public.shipment_documents d
       where d.job_id in (j.id, j.master_job_id)
         and public.partner_can_open(d.storage_path)), '[]'::jsonb),

    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('step', t.step, 'done', t.done, 'planned_date', t.planned_date,
                                          'actual_date', t.actual_date)
                       order by t.sort_order)
        from public.job_timeline_steps t
       where t.job_id = j.id and not t.skipped), '[]'::jsonb),

    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'body', m.body, 'created_at', m.created_at)
                       order by m.created_at)
        from public.job_partner_messages m
       where m.job_id = j.id and m.partner_id = p), '[]'::jsonb),

    'tracking', (
      select jsonb_build_object('vessel_name', t.vessel_name, 'voyage', t.voyage, 'status', t.tracking_status,
                                'vessel_lat', t.vessel_lat, 'vessel_lon', t.vessel_lon, 'position_at', t.position_at,
                                'speed_kn', t.speed_kn, 'pol_lat', t.pol_lat, 'pol_lon', t.pol_lon,
                                'pod_lat', t.pod_lat, 'pod_lon', t.pod_lon, 'route_path', t.route_path,
                                'pol', t.pol, 'pod', t.pod, 'eta', t.eta, 'synced_at', t.synced_at,
                                'atd', t.atd, 'etd', coalesce(t.etd, j.etd), 'pod_ata', t.pod_ata, 'pod_eta', t.pod_eta)
        from public.job_tracking t
       where t.job_id = coalesce(j.master_job_id, j.id)
       order by t.synced_at desc nulls last limit 1),

    'history', coalesce((
      select jsonb_agg(jsonb_build_object('at', h.changed_at, 'status', h.status) order by h.changed_at desc)
        from public.job_status_history h where h.job_id = j.id), '[]'::jsonb)
  );
  res := res || jsonb_build_object('acceptance', public.partner_acceptance(p_job));
  if res ->> 'acceptance' <> 'accepted' then
    res := res - 'documents' - 'messages' - 'pickup' - 'delivery' - 'history';
  end if;
  return res;
end;
$$;
revoke execute on function public.partner_shipment(uuid) from public, anon;
grant execute on function public.partner_shipment(uuid) to authenticated;
