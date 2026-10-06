-- 0153: Customer Portal quotation revisions.
--
-- A customer can ask ExPac to revise a quotation that is ready for them
-- (sent) or not proceeding (lost): what to change (better price, route /
-- mode, dates, cargo, other), an optional target price and a note.
--   * The quote goes back to ExPac (status open, revision_pending) and a
--     Control Tower task is opened for the team.
--   * When ExPac sets it to Quote Sent again, revision_no goes up by one
--     (same quote number, "Revision 2") and the request is marked answered.
--   * A declined / not proceeding quote that is still valid can be accepted
--     after all (portal_quote_decision now allows accept from lost).
--
-- Run in the Supabase SQL Editor after 0152.

alter table public.quotes
  add column if not exists revision_no int not null default 1,
  add column if not exists revision_pending boolean not null default false;

create table if not exists public.quote_revision_requests (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references public.quotes (id) on delete cascade,
  client_id     uuid references public.clients (id) on delete cascade,
  revision_no   int not null,               -- the revision the customer asked about
  reasons       text[] not null default '{}',
  target_price  numeric,
  note          text,
  requested_at  timestamptz not null default now(),
  requested_by  uuid default auth.uid(),
  answered_at   timestamptz,
  task_id       uuid references public.ops_tasks (id) on delete set null
);
create index if not exists quote_revision_requests_quote_idx on public.quote_revision_requests (quote_id);

alter table public.quote_revision_requests enable row level security;
drop policy if exists "team full access" on public.quote_revision_requests;
create policy "team full access" on public.quote_revision_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "customer reads own" on public.quote_revision_requests;
create policy "customer reads own" on public.quote_revision_requests
  for select to authenticated using (client_id = public.my_client_id());

-- Customer asks for a revision.
create or replace function public.portal_request_revision(p_quote uuid, p_reasons text[], p_target numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotes%rowtype;
  rid uuid;
  tid uuid;
begin
  select * into q from public.quotes where id = p_quote;
  if not found or q.client_id is null or q.client_id is distinct from public.my_client_id() then
    raise exception 'Quotation not found';
  end if;
  if q.status not in ('sent', 'lost') then
    raise exception 'This quotation can''t be revised now';
  end if;
  if coalesce(array_length(p_reasons, 1), 0) = 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'Tell us what you''d like changed';
  end if;

  insert into public.quote_revision_requests (quote_id, client_id, revision_no, reasons, target_price, note)
  values (q.id, q.client_id, q.revision_no, coalesce(p_reasons, '{}'), p_target, nullif(trim(p_note), ''))
  returning id into rid;

  update public.quotes set
    status = 'open',
    revision_pending = true,
    portal_decision = null,
    portal_decided_at = null,
    portal_decline_reason = null
  where id = q.id;

  insert into public.ops_tasks (kind, title, body, status, priority, quote_id, client_id,
                                from_portal, portal_visible, created_by)
  values ('task', 'Revise quotation ' || q.reference || ' (customer request)',
          'Customer asked for a revision: ' ||
            coalesce(nullif(array_to_string(p_reasons, ', '), ''), 'see note') ||
            case when p_target is not null then '. Target price R ' || to_char(p_target, 'FM999G999G990D00') else '' end ||
            case when coalesce(trim(p_note), '') <> '' then '. Note: ' || trim(p_note) else '' end ||
            '. Revise it in the Quote Builder and set it to Quote Sent.',
          'open', 'high', q.id, q.client_id, true, false, auth.uid())
  returning id into tid;
  update public.quote_revision_requests set task_id = tid where id = rid;
  return rid;
end;
$$;
grant execute on function public.portal_request_revision(uuid, text[], numeric, text) to authenticated;

-- Re-sent after a revision request: next revision number, request answered,
-- its task done.
create or replace function public.quote_revision_sent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' and old.revision_pending then
    new.revision_no := old.revision_no + 1;
    new.revision_pending := false;
    update public.ops_tasks set status = 'done', done_at = now()
      where id in (select task_id from public.quote_revision_requests where quote_id = new.id and answered_at is null)
        and status <> 'done';
    update public.quote_revision_requests set answered_at = now()
      where quote_id = new.id and answered_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_revision_sent on public.quotes;
create trigger trg_quote_revision_sent
  before update of status on public.quotes
  for each row execute function public.quote_revision_sent();

-- Accept after all: a declined / not proceeding quote that is still valid.
create or replace function public.portal_quote_decision(p_quote uuid, p_accept boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote;
  if not found or q.client_id is null or q.client_id is distinct from public.my_client_id() then
    raise exception 'Quotation not found';
  end if;
  if not (q.status = 'sent' or (p_accept and q.status = 'lost')) then
    raise exception 'This quotation can''t be % now', case when p_accept then 'accepted' else 'declined' end;
  end if;
  if q.valid_until is not null and q.valid_until < current_date and p_accept then
    raise exception 'This quotation expired on %, request a revision for updated pricing', to_char(q.valid_until, 'DD/MM/YYYY');
  end if;
  update public.quotes set
    portal_decision = case when p_accept then 'accepted' else 'declined' end,
    portal_decided_at = now(),
    portal_decline_reason = case when p_accept then null else nullif(p_reason, '') end,
    -- Accepted = won: the trg_quote_won trigger creates the shipment.
    status = case when p_accept then 'accepted' else 'lost' end
  where id = p_quote;
end;
$$;
grant execute on function public.portal_quote_decision(uuid, boolean, text) to authenticated;

-- Customer view of quotes: + revision number / pending (appended).
create or replace view public.client_quotes
with (security_barrier = true) as
select
  q.id, q.reference, q.client_id, q.mode, q.commodity, q.origin, q.destination,
  q.delivery_terms, q.valid_until, q.status, q.commercial_value,
  q.insurance_amount, q.vessel_name, q.mbl_no, q.hbl_no, q.container_no,
  q.etd, q.eta, q.incoterms, q.mawb_no, q.hawb_no, q.flight_no, q.flight_date,
  q.carrier_name, q.created_at,
  s.company as supplier_company,
  q.customer_reference, q.portal_requested_at, q.request_ready_date, q.request_pickup,
  q.request_delivery, q.request_notes, q.portal_decision, q.portal_decided_at,
  q.portal_decline_reason, q.sell_currency, q.accepted_at,
  q.wms_receipt_ids,
  q.value_currency,
  cn.company as consignee_company,
  case q.sell_currency
    when 'USD' then q.fx_usd_zar
    when 'CNY' then q.fx_cny_zar
    when 'EUR' then q.fx_eur_zar
    when 'GBP' then q.fx_gbp_zar
    else null
  end as sell_fx,
  q.revision_no,
  q.revision_pending
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
left join public.clients cn on cn.id = q.consignee_id
where q.client_id = public.my_client_id();
grant select on public.client_quotes to authenticated;
