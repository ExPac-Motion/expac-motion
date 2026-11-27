-- =====================================================================
-- 0251 Partner Portal: invoices & statements (portal-native)
-- =====================================================================
-- A partner submits their invoice per shipment on the portal (number,
-- dates, currency, amounts and the PDF, which is stored as the job's
-- "Supplier Invoice" document). ExPac approves it, queries it (the partner
-- replies with a note / new PDF) or marks it paid. The partner's
-- statement is built from these rows. No Sage sync.
--
--   partner_invoices()                 the signed-in partner's invoices, with
--                                      what ExPac expects from their buy lines
--   partner_submit_invoice(...)        new invoice on an accepted shipment
--   partner_reply_invoice_query(...)   answer a query (back to submitted)
--   staff_partner_invoice_action(...)  approve / query / mark paid (staff)
-- Every staff action messages the partner on the shipment; every partner
-- action opens a Control Tower task.
--
-- Run in the Supabase SQL editor after 0250. Self-contained & idempotent.
-- =====================================================================

create table if not exists public.partner_invoices (
  id            uuid primary key default gen_random_uuid(),
  partner_kind  text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id    uuid not null,
  job_id        uuid not null references public.jobs (id) on delete cascade,
  invoice_no    text not null check (length(btrim(invoice_no)) between 1 and 60),
  invoice_date  date not null,
  due_date      date,
  currency      text not null default 'USD',
  amount_excl   numeric(14, 2) not null default 0,
  vat           numeric(14, 2) not null default 0,
  total         numeric(14, 2) not null,
  document_id   uuid references public.shipment_documents (id) on delete set null,
  status        text not null default 'submitted' check (status in ('submitted', 'approved', 'queried', 'paid')),
  query_note    text,
  reply_note    text,
  paid_amount   numeric(14, 2),
  paid_at       date,
  payment_ref   text,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (partner_kind, partner_id, invoice_no)
);
create index if not exists partner_invoices_partner_idx on public.partner_invoices (partner_kind, partner_id);
create index if not exists partner_invoices_job_idx on public.partner_invoices (job_id);
alter table public.partner_invoices enable row level security;
drop policy if exists "team full access" on public.partner_invoices;
create policy "team full access" on public.partner_invoices
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- What ExPac expects to pay this partner on a job: their buy lines summed
-- per currency (same category rule as partner_shipment's charges).
create or replace function public.partner_expected_on_job(p_job uuid, p_kind text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(cur, amt), '{}'::jsonb)
    from (
      select l.cur, round(sum(l.buy * coalesce(l.qty, 1))::numeric, 2) as amt
        from public.quote_lines l
       where l.quote_id = (select coalesce(j.quote_id, m.quote_id)
                             from public.jobs j left join public.jobs m on m.id = j.master_job_id
                            where j.id = p_job)
         and coalesce(l.buy, 0) > 0
         and case
               when l.category = 'Destination Handling and Delivery Charges' and coalesce(l.code, '') ~ '^(TR|WH)-' then 'transporter'
               when l.category in ('International Freight Charges', 'Ex-Works Charges', 'FOB Charges') then 'agent'
               when l.category = 'Destination Handling and Delivery Charges' then 'destination_agent'
               when l.category = 'Customs Clearance, VAT and Duty Charges' then 'clearing_agent'
             end = p_kind
       group by l.cur
    ) x;
$$;
revoke execute on function public.partner_expected_on_job(uuid, text) from public, anon, authenticated;

-- One invoice as JSON (shared by the partner list and the staff tab).
create or replace function public.partner_invoice_json(i public.partner_invoices)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'partner_kind', i.partner_kind, 'partner_id', i.partner_id,
    'job_id', i.job_id, 'reference', j.reference,
    'invoice_no', i.invoice_no, 'invoice_date', i.invoice_date, 'due_date', i.due_date,
    'currency', i.currency, 'amount_excl', i.amount_excl, 'vat', i.vat, 'total', i.total,
    'status', i.status, 'query_note', i.query_note, 'reply_note', i.reply_note,
    'paid_amount', i.paid_amount, 'paid_at', i.paid_at, 'payment_ref', i.payment_ref,
    'created_at', i.created_at, 'updated_at', i.updated_at,
    'document_path', d.storage_path, 'document_name', d.name,
    'expected', public.partner_expected_on_job(i.job_id, i.partner_kind))
  from public.jobs j left join public.shipment_documents d on d.id = i.document_id
  where j.id = i.job_id;
$$;
revoke execute on function public.partner_invoice_json(public.partner_invoices) from public, anon;
grant execute on function public.partner_invoice_json(public.partner_invoices) to authenticated;

-- ---------- Partner side ----------
create or replace function public.partner_invoices()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.partner_invoice_json(i) order by i.invoice_date desc, i.created_at desc), '[]'::jsonb)
    from public.partner_invoices i
   where i.partner_kind = public.my_partner_kind() and i.partner_id = public.my_partner_id();
$$;
revoke execute on function public.partner_invoices() from public, anon;
grant execute on function public.partner_invoices() to authenticated;

create or replace function public.partner_submit_invoice(
  p_job uuid, p_invoice_no text, p_invoice_date date, p_due_date date,
  p_currency text, p_amount_excl numeric, p_vat numeric, p_total numeric, p_document_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  who text := coalesce(public.partner_company_name(), 'Partner');
  v_id uuid;
begin
  if not public.partner_can_job(p_job::text) then
    raise exception 'This shipment is not assigned to you';
  end if;
  if public.partner_acceptance(p_job) <> 'accepted' then
    raise exception 'Accept this shipment first';
  end if;
  if coalesce(btrim(p_invoice_no), '') = '' then
    raise exception 'Enter your invoice number';
  end if;
  if coalesce(p_total, 0) <= 0 then
    raise exception 'Enter the invoice total';
  end if;
  if p_document_id is not null and not exists (
       select 1 from public.shipment_documents d
        where d.id = p_document_id and d.job_id = p_job and d.from_partner_id = p) then
    raise exception 'Attach the invoice PDF to this shipment first';
  end if;
  if exists (select 1 from public.partner_invoices i
              where i.partner_kind = k and i.partner_id = p and lower(i.invoice_no) = lower(btrim(p_invoice_no))) then
    raise exception 'You already submitted invoice %', btrim(p_invoice_no);
  end if;
  insert into public.partner_invoices (partner_kind, partner_id, job_id, invoice_no, invoice_date, due_date,
                                       currency, amount_excl, vat, total, document_id)
  values (k, p, p_job, btrim(p_invoice_no), p_invoice_date, p_due_date,
          upper(coalesce(nullif(btrim(p_currency), ''), 'USD')), coalesce(p_amount_excl, 0), coalesce(p_vat, 0), p_total, p_document_id)
  returning id into v_id;
  perform public.partner_task_for_expac(p_job, who || ' submitted invoice ' || btrim(p_invoice_no),
    'Total ' || upper(coalesce(p_currency, 'USD')) || ' ' || to_char(p_total, 'FM999G999G990D00')
    || '. Approve, query or mark it paid on the vendor record > Invoices.', 'normal');
  return v_id;
end;
$$;
revoke execute on function public.partner_submit_invoice(uuid, text, date, date, text, numeric, numeric, numeric, uuid) from public, anon;
grant execute on function public.partner_submit_invoice(uuid, text, date, date, text, numeric, numeric, numeric, uuid) to authenticated;

create or replace function public.partner_reply_invoice_query(p_id uuid, p_note text, p_document_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.partner_invoices%rowtype;
  who text := coalesce(public.partner_company_name(), 'Partner');
begin
  select * into i from public.partner_invoices
   where id = p_id and partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id();
  if not found then
    raise exception 'Invoice not found';
  end if;
  if i.status <> 'queried' then
    raise exception 'This invoice has no open query';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Write your answer to the query';
  end if;
  update public.partner_invoices
     set status = 'submitted', reply_note = btrim(p_note),
         document_id = coalesce(p_document_id, document_id), updated_at = now()
   where id = p_id;
  perform public.partner_task_for_expac(i.job_id, who || ' answered the query on invoice ' || i.invoice_no, btrim(p_note), 'normal');
end;
$$;
revoke execute on function public.partner_reply_invoice_query(uuid, text, uuid) from public, anon;
grant execute on function public.partner_reply_invoice_query(uuid, text, uuid) to authenticated;

-- ---------- Staff side ----------
create or replace function public.staff_partner_invoices(p_kind text, p_partner uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;
  return coalesce((
    select jsonb_agg(public.partner_invoice_json(i) order by i.invoice_date desc, i.created_at desc)
      from public.partner_invoices i where i.partner_kind = p_kind and i.partner_id = p_partner), '[]'::jsonb);
end;
$$;
revoke execute on function public.staff_partner_invoices(text, uuid) from public, anon;
grant execute on function public.staff_partner_invoices(text, uuid) to authenticated;

-- p_action: 'approve' | 'query' (p_note required) | 'paid' (amount, date, ref)
create or replace function public.staff_partner_invoice_action(
  p_id uuid, p_action text, p_note text default null,
  p_paid_amount numeric default null, p_paid_at date default null, p_payment_ref text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.partner_invoices%rowtype;
  msg text;
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;
  select * into i from public.partner_invoices where id = p_id;
  if not found then
    raise exception 'Invoice not found';
  end if;
  if p_action = 'approve' then
    update public.partner_invoices set status = 'approved', updated_at = now() where id = p_id;
    msg := 'Your invoice ' || i.invoice_no || ' has been approved for payment.';
  elsif p_action = 'query' then
    if coalesce(btrim(p_note), '') = '' then
      raise exception 'Write the query for the partner';
    end if;
    update public.partner_invoices set status = 'queried', query_note = btrim(p_note), updated_at = now() where id = p_id;
    msg := 'Query on your invoice ' || i.invoice_no || ': ' || btrim(p_note) || ' (answer it on the Invoices page).';
  elsif p_action = 'paid' then
    update public.partner_invoices
       set status = 'paid', paid_amount = coalesce(p_paid_amount, i.total), paid_at = coalesce(p_paid_at, current_date),
           payment_ref = nullif(btrim(coalesce(p_payment_ref, '')), ''), updated_at = now()
     where id = p_id;
    msg := 'Invoice ' || i.invoice_no || ' paid: ' || i.currency || ' '
           || to_char(coalesce(p_paid_amount, i.total), 'FM999G999G990D00')
           || ' on ' || to_char(coalesce(p_paid_at, current_date), 'DD/MM/YYYY')
           || coalesce(', ref ' || nullif(btrim(coalesce(p_payment_ref, '')), ''), '') || '.';
  else
    raise exception 'Unknown action';
  end if;
  -- Tell the partner on the shipment thread.
  insert into public.job_partner_messages (job_id, partner_kind, partner_id, direction, body)
  values (i.job_id, i.partner_kind, i.partner_id, 'out', msg);
end;
$$;
revoke execute on function public.staff_partner_invoice_action(uuid, text, text, numeric, date, text) from public, anon;
grant execute on function public.staff_partner_invoice_action(uuid, text, text, numeric, date, text) to authenticated;

notify pgrst, 'reload schema';
