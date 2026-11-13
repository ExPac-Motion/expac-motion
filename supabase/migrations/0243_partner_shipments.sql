-- ============================================================
-- 0243  Partner Portal: Shipments (docs/partner-portal-shipments-plan.md)
-- ============================================================
-- A partner login (0121: role 'partner', partner_kind + partner_id) sees the
-- shipments it is assigned to, its own leg only:
--   origin agent       quotes.agent_id of the shipment's quote
--   destination agent  quotes.destination_agent_id
--   transporter        quotes.transporter_id
--   clearing agent     customs_files.clearing_agent_id, else quotes.clearing_agent_id
-- A master's partner also sees its houses.
--
-- Everything goes through SECURITY DEFINER functions with a fixed column
-- list per partner kind: never the customer's company or contacts, sell
-- rates, margin, the quotation, other partners or the customer chat.
--
--   partner_shipments()            the list (active + delivered in the last 60 days)
--   partner_shipment(job)          one shipment: facts, packing, own buy lines,
--                                  documents, timeline, messages, tracking
--   partner_update_shipment(job,p) booking fields / status / delay / POD per kind;
--                                  logs job_events + a Control Tower task
--   partner_add_document(...)      upload into shipment-documents/partner/<job>/
--   partner_send_message(job,txt)  message to ExPac (job_partner_messages)
--
-- Uploads are never visible to the customer until staff share them. Partners
-- delete nothing.
--
-- Run in the Supabase SQL editor after 0242. Self-contained & idempotent.

-- ---------- 1. Columns + messages table ----------
alter table public.shipment_documents add column if not exists from_partner_kind text;
alter table public.shipment_documents add column if not exists from_partner_id uuid;

create table if not exists public.job_partner_messages (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  partner_kind  text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id    uuid not null,
  direction     text not null check (direction in ('in', 'out')),
  body          text not null check (length(body) between 1 and 4000),
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists job_partner_messages_job_idx on public.job_partner_messages (job_id, created_at);

alter table public.job_partner_messages enable row level security;
drop policy if exists "team full access" on public.job_partner_messages;
create policy "team full access" on public.job_partner_messages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 2. Which shipments are mine ----------
create or replace function public.partner_job_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (select public.my_partner_kind() as k, public.my_partner_id() as p),
  direct as (
    select j.id
      from public.jobs j
      join public.quotes q on q.id = j.quote_id
      cross join me
     where me.p is not null and (
           (me.k = 'agent' and q.agent_id = me.p)
        or (me.k = 'transporter' and q.transporter_id = me.p)
        or (me.k = 'destination_agent' and q.destination_agent_id = me.p)
        or (me.k = 'clearing_agent' and q.clearing_agent_id = me.p
            and not exists (select 1 from public.customs_files cf
                             where cf.job_id = j.id and cf.clearing_agent_id is not null
                               and cf.clearing_agent_id <> me.p)))
    union
    select cf.job_id
      from public.customs_files cf cross join me
     where me.k = 'clearing_agent' and me.p is not null and cf.clearing_agent_id = me.p
  )
  select id from direct
  union
  select h.id from public.jobs h where h.master_job_id in (select id from direct);
$$;
revoke execute on function public.partner_job_ids() from public, anon;
grant execute on function public.partner_job_ids() to authenticated;

create or replace function public.partner_can_job(p_job text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_job is null or p_job !~* '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return exists (select 1 from public.partner_job_ids() x where x = p_job::uuid);
end;
$$;
revoke execute on function public.partner_can_job(text) from public, anon;
grant execute on function public.partner_can_job(text) to authenticated;

-- The partner's company name (for logs and tasks).
create or replace function public.partner_company_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select company from public.my_partner() limit 1), 'Partner');
$$;

-- Sea modes carry a container; air modes a flight.
create or replace function public.partner_is_air(p_mode text)
returns boolean language sql immutable as $$
  select coalesce(p_mode, '') ilike '%air%';
$$;

-- ---------- 3. Storage: open the shipment's documents, upload to partner/<job>/ ----------
create or replace function public.partner_can_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_partner_id() is not null and exists (
    select 1
      from public.shipment_documents sd
      join public.jobs j on j.id in (select public.partner_job_ids())
     where sd.storage_path = p_path
       and (sd.job_id = j.id or sd.job_id = j.master_job_id)
       -- invoices to the customer stay with ExPac
       and coalesce(sd.doc_type, '') <> 'Invoice'
       and (sd.from_partner_id is null or sd.from_partner_id = public.my_partner_id()
            or sd.kind = 'generated' or sd.from_broker));
$$;
revoke execute on function public.partner_can_open(text) from public, anon;
grant execute on function public.partner_can_open(text) to authenticated;

drop policy if exists "partners open shipment documents" on storage.objects;
create policy "partners open shipment documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'shipment-documents' and public.partner_can_open(name));

drop policy if exists "partners upload shipment documents" on storage.objects;
create policy "partners upload shipment documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shipment-documents'
    and (storage.foldername(name))[1] = 'partner'
    and public.partner_can_job((storage.foldername(name))[2]));

-- ---------- 4. The list ----------
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
      'awb_mbl', j.awb_mbl,
      'container_no', j.container_no,
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

-- ---------- 5. One shipment ----------
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
                                          'qty', coalesce(l.qty_override, l.qty))
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
  return res;
end;
$$;
revoke execute on function public.partner_shipment(uuid) from public, anon;
grant execute on function public.partner_shipment(uuid) to authenticated;

-- Opening a shipment marks ExPac's messages to this partner as read.
create or replace function public.partner_mark_read(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.partner_can_job(p_job::text) then
    return;
  end if;
  update public.job_partner_messages
     set read_at = now()
   where job_id = p_job and partner_id = public.my_partner_id() and direction = 'out' and read_at is null;
end;
$$;
revoke execute on function public.partner_mark_read(uuid) from public, anon;
grant execute on function public.partner_mark_read(uuid) to authenticated;

-- ---------- 6. Control Tower task for ExPac ----------
create or replace function public.partner_task_for_expac(p_job uuid, p_title text, p_body text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
begin
  select * into j from public.jobs where id = p_job;
  insert into public.ops_tasks (kind, title, body, status, priority, job_id, client_id, created_by,
                                agent_id, transporter_id, clearing_agent_id)
  values ('task', p_title || ' – ' || coalesce(j.reference, ''), p_body, 'open', p_priority, j.id, j.client_id, auth.uid(),
          case when k = 'agent' then p end,
          case when k = 'transporter' then p end,
          case when k = 'clearing_agent' then p end);
end;
$$;
revoke execute on function public.partner_task_for_expac(uuid, text, text, text) from public, anon, authenticated;

-- ---------- 7. Updates from the partner ----------
-- p (jsonb), any of:
--   status                 a status this partner kind may set (below)
--   carrier_name, shipping_line, vessel_name, voyage_no, awb_mbl,
--   container_no, seal_no, etd, eta            origin agent only
--   pod_signed_by, pod_delivered_at            transporter / destination agent, with Delivered
--   delay_reason + delay_date                  anyone: a delay and the new date
--   note                                       free text, logged with the change
create or replace function public.partner_update_shipment(p_job uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  who text := public.partner_company_name();
  j public.jobs%rowtype;
  st text := nullif(btrim(coalesce(p ->> 'status', '')), '');
  allowed text[];
  changes text[] := '{}';
  f text;
  v text;
  d date;
  note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  reason text := nullif(btrim(coalesce(p ->> 'delay_reason', '')), '');
  ms text;
  n int;
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  select * into j from public.jobs where id = p_job for update;
  if j.ops_completed_at is not null then
    raise exception 'This shipment is closed';
  end if;

  -- Statuses per partner kind.
  allowed := case k
    when 'agent' then array['Booked', 'Vessel Booked', 'Flight Booked', 'Collected', 'Received', 'Loaded', 'Departed']
    when 'transporter' then array['Collected', 'On-Delivery', 'Delivered']
    when 'destination_agent' then array['Arrived', 'Unloaded', 'On-Delivery', 'Delivered']
    else array[]::text[]
  end;
  if st is not null and not (st = any (allowed)) then
    raise exception 'You can''t set the status %', st;
  end if;

  -- Booking details (origin agent).
  if k = 'agent' then
    foreach f in array array['carrier_name', 'shipping_line', 'vessel_name', 'voyage_no', 'awb_mbl', 'container_no', 'seal_no'] loop
      if p ? f then
        v := nullif(btrim(coalesce(p ->> f, '')), '');
        if v is not null and length(v) > 120 then
          raise exception 'Too long: %', f;
        end if;
        execute format('update public.jobs set %I = $1 where id = $2 and %I is distinct from $1', f, f) using v, p_job;
        get diagnostics n = row_count;
        if n > 0 then
          changes := changes || (replace(initcap(replace(f, '_', ' ')), 'Awb Mbl', 'MBL / AWB') || ': ' || coalesce(v, '-'));
        end if;
      end if;
    end loop;
    foreach f in array array['etd', 'eta'] loop
      if p ? f then
        d := nullif(p ->> f, '')::date;
        execute format('update public.jobs set %I = $1 where id = $2 and %I is distinct from $1', f, f) using d, p_job;
        get diagnostics n = row_count;
        if n > 0 then
          changes := changes || (upper(f) || ': ' || coalesce(to_char(d, 'DD/MM/YYYY'), '-'));
        end if;
      end if;
    end loop;
  elsif p ?| array['carrier_name', 'shipping_line', 'vessel_name', 'voyage_no', 'awb_mbl', 'container_no', 'seal_no', 'etd', 'eta'] then
    raise exception 'Only the origin agent can change the booking details';
  end if;

  -- Proof of delivery.
  if (p ? 'pod_signed_by' or p ? 'pod_delivered_at') then
    if k not in ('transporter', 'destination_agent') then
      raise exception 'Only the delivering partner can add the POD';
    end if;
    update public.jobs
       set pod_signed_by = coalesce(nullif(btrim(coalesce(p ->> 'pod_signed_by', '')), ''), pod_signed_by),
           pod_delivered_at = coalesce(nullif(p ->> 'pod_delivered_at', '')::date, pod_delivered_at)
     where id = p_job;
    changes := changes || ('POD: signed by ' || coalesce(nullif(btrim(coalesce(p ->> 'pod_signed_by', '')), ''), '-')
                           || coalesce(' on ' || to_char(nullif(p ->> 'pod_delivered_at', '')::date, 'DD/MM/YYYY'), ''));
  end if;

  -- A delay and the new date: the agent moves the ETA, the delivering partner the delivery date.
  if reason is not null then
    d := nullif(p ->> 'delay_date', '')::date;
    if d is not null then
      if k = 'agent' then
        update public.jobs set eta = d where id = p_job;
      elsif k in ('transporter', 'destination_agent') then
        update public.jobs set provisional_delivery_date = d where id = p_job;
      end if;
    end if;
    changes := changes || ('Delay: ' || reason || coalesce(', new date ' || to_char(d, 'DD/MM/YYYY'), ''));
  end if;

  -- Status last, so the timeline / history triggers see the new dates.
  if st is not null and st is distinct from btrim(coalesce(j.shipment_status, '')) then
    update public.jobs set shipment_status = st where id = p_job;
    changes := changes || ('Status: ' || st);
  end if;

  if cardinality(changes) = 0 and note is null then
    raise exception 'Nothing to save';
  end if;

  select milestone into ms from public.jobs where id = p_job;
  ms := coalesce(case when st is not null then public.milestone_for_status(st) end, ms);
  if st is not null and public.milestone_for_status(st) is not null then
    update public.jobs set milestone = ms where id = p_job and milestone is distinct from ms;
  end if;
  insert into public.job_events (job_id, milestone, note, created_by)
  values (p_job, ms,
          who || ': ' || array_to_string(changes, '; ') || coalesce(case when cardinality(changes) > 0 then '. ' else '' end || note, ''),
          auth.uid());

  perform public.partner_task_for_expac(p_job,
    case when reason is not null then 'Delay reported by ' || who
         when st is not null then who || ' set ' || st
         when cardinality(changes) > 0 then who || ' updated the shipment'
         else 'Note from ' || who end,
    array_to_string(changes, E'\n') || coalesce(E'\n' || note, ''),
    case when reason is not null then 'high' else 'normal' end);
end;
$$;
revoke execute on function public.partner_update_shipment(uuid, jsonb) from public, anon;
grant execute on function public.partner_update_shipment(uuid, jsonb) to authenticated;

-- ---------- 8. Documents from the partner ----------
create or replace function public.partner_add_document(p_job uuid, p_name text, p_path text, p_doc_type text, p_size bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  who text := public.partner_company_name();
  allowed text[];
  v_id uuid;
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  allowed := case k
    when 'agent' then array['Bill of Lading / AWB', 'HBL', 'HAWB', 'Commercial Invoice', 'Packing List', 'Certificate of Origin', 'Supplier Invoice', 'Photos', 'Other']
    when 'transporter' then array['Proof of Delivery', 'Delivery Note', 'Supplier Invoice', 'Photos', 'Other']
    when 'destination_agent' then array['Arrival Notification (ANF)', 'Proof of Delivery', 'Delivery Note', 'Supplier Invoice', 'Photos', 'Other']
    when 'clearing_agent' then array['Customs Release Note', 'Customs Entry', 'Duty / VAT Invoice', 'Customs', 'Supplier Invoice', 'Other']
    else array[]::text[]
  end;
  if not (p_doc_type = any (allowed)) then
    raise exception 'Pick a document type';
  end if;
  if p_path is null or p_path not like 'partner/' || p_job::text || '/%' then
    raise exception 'Upload the file to this shipment first';
  end if;
  insert into public.shipment_documents (job_id, name, storage_path, kind, doc_type, size_bytes, visible_to_client,
                                         from_partner_kind, from_partner_id)
  values (p_job, left(coalesce(nullif(btrim(p_name), ''), 'Document'), 200), p_path, 'upload', p_doc_type, p_size, false,
          k, public.my_partner_id())
  returning id into v_id;
  insert into public.job_events (job_id, milestone, note, created_by)
  select p_job, j.milestone, who || ' uploaded ' || p_doc_type || ': ' || coalesce(p_name, ''), auth.uid()
    from public.jobs j where j.id = p_job;
  perform public.partner_task_for_expac(p_job, who || ' uploaded ' || p_doc_type, 'File: ' || coalesce(p_name, '') || '.',
    case when p_doc_type in ('Proof of Delivery', 'Customs Release Note', 'Bill of Lading / AWB') then 'high' else 'normal' end);
  return v_id;
end;
$$;
revoke execute on function public.partner_add_document(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.partner_add_document(uuid, text, text, text, bigint) to authenticated;

-- ---------- 9. Messages to ExPac ----------
create or replace function public.partner_send_message(p_job uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b text := nullif(btrim(coalesce(p_body, '')), '');
  who text := public.partner_company_name();
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  if b is null then
    raise exception 'Write a message';
  end if;
  insert into public.job_partner_messages (job_id, partner_kind, partner_id, direction, body)
  values (p_job, public.my_partner_kind(), public.my_partner_id(), 'in', left(b, 4000));
  perform public.partner_task_for_expac(p_job, 'Message from ' || who, left(b, 1000), 'normal');
end;
$$;
revoke execute on function public.partner_send_message(uuid, text) from public, anon;
grant execute on function public.partner_send_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
