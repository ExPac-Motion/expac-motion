-- =====================================================================
-- 0255 Partner Portal: Compliance & Document Vault
-- =====================================================================
-- Partners (agents, transporters, clearing agents, destination agents)
-- accept ExPac's legal documents in the portal by click-to-accept:
--   nda                 Non-Disclosure Agreement (customer data)  - blocks the portal
--   agency_agreement    Agency Agreement
--   terms               Terms & Conditions
--   credit_application  Credit Application (a form; ExPac approves / declines)
--
-- compliance_documents holds every version. The CURRENT document of a kind
-- is its latest published version. Publishing a new version asks every
-- partner to accept again.
--
-- NDA gate: while a partner has not accepted every current document marked
-- blocks_portal, partner_job_ids() and broker_agent_id() return nothing, so
-- no shipment, customs file or document reaches them.
--
-- The four documents are seeded as UNPUBLISHED DRAFTS for legal review.
-- Nothing changes for partners until staff publish them in
-- Settings > Compliance.
--
-- Run in the Supabase SQL editor after 0254. Self-contained & idempotent.
-- =====================================================================

-- ---------- 1. Tables ----------
create table if not exists public.compliance_documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('nda', 'agency_agreement', 'terms', 'credit_application')),
  version       integer not null default 1,
  title         text not null,
  summary       text,
  body          text not null default '',
  required_for  text[] not null default array['agent', 'transporter', 'clearing_agent', 'destination_agent'],
  blocks_portal boolean not null default false,
  published_at  timestamptz,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (kind, version)
);

alter table public.compliance_documents enable row level security;
drop policy if exists "team full access" on public.compliance_documents;
create policy "team full access" on public.compliance_documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- A published version is frozen: what a partner accepted never changes.
create or replace function public.compliance_documents_guard()
returns trigger language plpgsql as $$
begin
  if old.published_at is not null and (new.body is distinct from old.body
       or new.title is distinct from old.title or new.version is distinct from old.version
       or new.kind is distinct from old.kind) then
    raise exception 'This version is published and can no longer be edited. Create a new version instead.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_compliance_documents_guard on public.compliance_documents;
create trigger trg_compliance_documents_guard before update on public.compliance_documents
  for each row execute function public.compliance_documents_guard();

create table if not exists public.partner_compliance_acceptances (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.compliance_documents (id) on delete restrict,
  partner_kind    text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent', 'destination_agent')),
  partner_id      uuid not null,
  accepted_by     uuid references auth.users (id) on delete set null default auth.uid(),
  signer_name     text not null,
  signer_title    text,
  signature       text not null,
  ip              text,
  user_agent      text,
  form_data       jsonb not null default '{}'::jsonb,
  accepted_at     timestamptz not null default now(),
  -- credit applications only
  review_status   text not null default 'n/a' check (review_status in ('n/a', 'pending', 'approved', 'declined')),
  credit_limit    numeric(14, 2),
  credit_currency text,
  payment_terms   text,
  review_note     text,
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  unique (document_id, partner_kind, partner_id)
);
create index if not exists partner_compliance_acceptances_partner_idx
  on public.partner_compliance_acceptances (partner_kind, partner_id);

alter table public.partner_compliance_acceptances enable row level security;
drop policy if exists "team full access" on public.partner_compliance_acceptances;
create policy "team full access" on public.partner_compliance_acceptances
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 2. Current documents + the gate ----------
-- The current (latest published) version of each kind.
create or replace function public.compliance_current()
returns setof public.compliance_documents language sql stable security definer set search_path = public as $$
  select distinct on (kind) *
    from public.compliance_documents
   where published_at is not null
   order by kind, version desc;
$$;
revoke execute on function public.compliance_current() from public, anon;
grant execute on function public.compliance_current() to authenticated;

-- True when the partner has accepted every current document that blocks the portal.
create or replace function public.partner_nda_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_partner_id() is not null and not exists (
    select 1 from public.compliance_current() d
     where d.blocks_portal
       and public.my_partner_kind() = any (d.required_for)
       and not exists (select 1 from public.partner_compliance_acceptances a
                        where a.document_id = d.id
                          and a.partner_kind = public.my_partner_kind()
                          and a.partner_id = public.my_partner_id()));
$$;
revoke execute on function public.partner_nda_ok() from public, anon;
grant execute on function public.partner_nda_ok() to authenticated;

-- Re-emitted from 0243 with the gate.
create or replace function public.partner_job_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (select public.my_partner_kind() as k, public.my_partner_id() as p
               where public.partner_nda_ok()),
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

-- Re-emitted from 0232 with the gate (clearing agents' customs files).
create or replace function public.broker_agent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public.my_partner_kind() = 'clearing_agent' and public.partner_nda_ok()
              then public.my_partner_id() end;
$$;

-- ---------- 3. Partner RPCs ----------
create or replace function public.partner_compliance_json(d public.compliance_documents)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'version', d.version, 'title', d.title, 'summary', d.summary,
    'body', d.body, 'blocks_portal', d.blocks_portal, 'published_at', d.published_at,
    'acceptance', (
      select jsonb_build_object(
        'id', a.id, 'document_id', a.document_id, 'version', cd.version,
        'current', a.document_id = d.id,
        'signer_name', a.signer_name, 'signer_title', a.signer_title, 'signature', a.signature,
        'accepted_at', a.accepted_at, 'form_data', a.form_data,
        'review_status', a.review_status, 'credit_limit', a.credit_limit,
        'credit_currency', a.credit_currency, 'payment_terms', a.payment_terms,
        'review_note', a.review_note, 'reviewed_at', a.reviewed_at)
        from public.partner_compliance_acceptances a
        join public.compliance_documents cd on cd.id = a.document_id
       where cd.kind = d.kind
         and a.partner_kind = public.my_partner_kind()
         and a.partner_id = public.my_partner_id()
       order by cd.version desc, a.accepted_at desc
       limit 1));
$$;
revoke execute on function public.partner_compliance_json(public.compliance_documents) from public, anon, authenticated;

-- The partner's Document Vault: every current document required for their kind.
create or replace function public.partner_compliance()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_partner_id() is null then
    raise exception 'Only a partner portal login can do this';
  end if;
  return jsonb_build_object(
    'ok', public.partner_nda_ok(),
    'documents', coalesce((
      select jsonb_agg(public.partner_compliance_json(d)
                       order by array_position(array['nda', 'agency_agreement', 'terms', 'credit_application'], d.kind))
        from public.compliance_current() d
       where public.my_partner_kind() = any (d.required_for)), '[]'::jsonb));
end;
$$;
revoke execute on function public.partner_compliance() from public, anon;
grant execute on function public.partner_compliance() to authenticated;

create or replace function public.partner_accept_compliance(
  p_document uuid, p_name text, p_title text, p_signature text, p_form jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
  d public.compliance_documents%rowtype;
  hdr jsonb;
  aid uuid;
  who text := coalesce(public.partner_company_name(), 'Partner');
begin
  if p is null then
    raise exception 'Only a partner portal login can do this';
  end if;
  select * into d from public.compliance_current() c where c.id = p_document;
  if d.id is null or not (k = any (d.required_for)) then
    raise exception 'This document is not open for acceptance';
  end if;
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_signature), '') = '' then
    raise exception 'Your full name and signature are required';
  end if;
  if lower(btrim(p_signature)) <> lower(btrim(p_name)) then
    raise exception 'Type your full name exactly as your signature';
  end if;
  if exists (select 1 from public.partner_compliance_acceptances
              where document_id = d.id and partner_kind = k and partner_id = p) then
    raise exception 'Your company has already accepted this version';
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    hdr := null;
  end;

  insert into public.partner_compliance_acceptances
    (document_id, partner_kind, partner_id, signer_name, signer_title, signature, ip, user_agent,
     form_data, review_status)
  values (d.id, k, p, btrim(p_name), nullif(btrim(p_title), ''), btrim(p_signature),
          split_part(coalesce(hdr ->> 'x-forwarded-for', hdr ->> 'cf-connecting-ip', ''), ',', 1),
          left(hdr ->> 'user-agent', 400),
          coalesce(p_form, '{}'::jsonb),
          case when d.kind = 'credit_application' then 'pending' else 'n/a' end)
  returning id into aid;

  insert into public.ops_tasks (kind, title, body, status, priority, created_by,
                                agent_id, transporter_id, clearing_agent_id)
  values ('task',
          case when d.kind = 'credit_application' then 'Credit application from ' || who
               else who || ' accepted the ' || d.title || ' (v' || d.version || ')' end,
          case when d.kind = 'credit_application'
               then 'Review it on the partner''s record > Compliance and approve or decline with a limit and payment terms.'
               else 'Accepted by ' || btrim(p_name) || coalesce(', ' || nullif(btrim(p_title), ''), '') || '.' end,
          'open', case when d.kind = 'credit_application' then 'high' else 'low' end, auth.uid(),
          case when k = 'agent' then p end, case when k = 'transporter' then p end,
          case when k = 'clearing_agent' then p end);
  return aid;
end;
$$;
revoke execute on function public.partner_accept_compliance(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.partner_accept_compliance(uuid, text, text, text, jsonb) to authenticated;

-- ---------- 4. Staff RPCs ----------
-- What one partner has accepted, and what is outstanding.
create or replace function public.staff_partner_compliance(p_kind text, p_partner uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;
  return jsonb_build_object(
    'current', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'version', d.version, 'title', d.title,
                                          'blocks_portal', d.blocks_portal,
                                          'accepted', exists (select 1 from public.partner_compliance_acceptances a
                                                               where a.document_id = d.id and a.partner_kind = p_kind
                                                                 and a.partner_id = p_partner))
                       order by array_position(array['nda', 'agency_agreement', 'terms', 'credit_application'], d.kind))
        from public.compliance_current() d where p_kind = any (d.required_for)), '[]'::jsonb),
    'acceptances', coalesce((
      select jsonb_agg(to_jsonb(a) || jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title,
                                                         'accepted_by_email', u.email)
                       order by a.accepted_at desc)
        from public.partner_compliance_acceptances a
        join public.compliance_documents d on d.id = a.document_id
        left join auth.users u on u.id = a.accepted_by
       where a.partner_kind = p_kind and a.partner_id = p_partner), '[]'::jsonb));
end;
$$;
revoke execute on function public.staff_partner_compliance(text, uuid) from public, anon;
grant execute on function public.staff_partner_compliance(text, uuid) to authenticated;

create or replace function public.staff_credit_decision(
  p_id uuid, p_approve boolean, p_limit numeric default null, p_currency text default null,
  p_terms text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only';
  end if;
  if p_approve and (p_limit is null or p_limit <= 0 or coalesce(btrim(p_terms), '') = '') then
    raise exception 'A credit limit and payment terms are required to approve';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Give a reason for declining';
  end if;
  update public.partner_compliance_acceptances
     set review_status = case when p_approve then 'approved' else 'declined' end,
         credit_limit = case when p_approve then p_limit end,
         credit_currency = case when p_approve then coalesce(nullif(btrim(p_currency), ''), 'ZAR') end,
         payment_terms = case when p_approve then btrim(p_terms) end,
         review_note = nullif(btrim(p_note), ''),
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and review_status <> 'n/a';
  if not found then
    raise exception 'Credit application not found';
  end if;
end;
$$;
revoke execute on function public.staff_credit_decision(uuid, boolean, numeric, text, text, text) from public, anon;
grant execute on function public.staff_credit_decision(uuid, boolean, numeric, text, text, text) to authenticated;

-- ---------- 5. Draft templates (unpublished, for legal review) ----------
insert into public.compliance_documents (kind, version, title, summary, body, blocks_portal, created_by)
select 'nda', 1, 'Non-Disclosure Agreement',
  'Protects the customer and shipment information ExPac shares with you. Required before you can see shipments.',
  $nda$DRAFT - FOR LEGAL REVIEW BEFORE PUBLISHING

## 1. Parties
This Non-Disclosure Agreement ("Agreement") is entered into between [ExPac legal entity name], registration number [number], of [address], South Africa ("ExPac"), and the partner company accepting this Agreement in the ExPac Partner Portal ("the Partner").

## 2. Purpose
ExPac appoints partners to carry out freight, transport, customs and related services on its behalf. To do so, ExPac shares information about its customers and their shipments with the Partner. This Agreement protects that information.

## 3. Confidential Information
"Confidential Information" means all information the Partner receives from ExPac or through the Partner Portal, in any form, including:
(a) the names, addresses, contact details and other personal information of ExPac's customers, consignees, shippers and their staff;
(b) shipment details, commercial invoices, packing lists, transport documents, cargo descriptions and values;
(c) ExPac's rates, pricing, margins, routings and business methods;
(d) any information marked or reasonably understood to be confidential.

## 4. Obligations of the Partner
The Partner shall:
(a) use the Confidential Information only to perform the services ExPac has asked of it;
(b) not disclose it to any third party except its own employees and sub-contractors who need it for those services and who are bound by obligations no less strict than these;
(c) not contact, solicit or quote ExPac's customers directly, or use their information for its own marketing, for the duration of this Agreement and for [24] months afterwards;
(d) keep the Confidential Information secure, using reasonable technical and organisational measures;
(e) notify ExPac in writing without delay of any actual or suspected unauthorised access, loss or disclosure.

## 5. Personal information (POPIA)
Where the Confidential Information includes personal information, the Partner acts as an operator on behalf of ExPac as defined in the Protection of Personal Information Act 4 of 2013 ("POPIA"). The Partner shall process it only on ExPac's instructions and for the services, apply the security safeguards required by section 19 of POPIA, notify ExPac immediately of any security compromise, and not transfer it outside its country of operation except as needed for the shipment.

## 6. Exceptions
The obligations do not apply to information that is or becomes public through no fault of the Partner, was lawfully known to the Partner before receiving it from ExPac, or must be disclosed by law or by a customs or other authority, in which case the Partner shall notify ExPac first where lawfully possible.

## 7. Return and destruction
On ExPac's request, or when the services end, the Partner shall return or securely destroy the Confidential Information, except where it must keep records by law.

## 8. Duration
This Agreement applies from acceptance and continues for as long as the Partner works with ExPac. The obligations of confidentiality survive termination for [5] years, and indefinitely for personal information.

## 9. Remedies
The Partner acknowledges that a breach may cause ExPac irreparable harm, and that ExPac may seek an interdict in addition to any other remedy, including damages.

## 10. General
This Agreement is governed by the laws of the Republic of South Africa. Acceptance in the Partner Portal by an authorised representative of the Partner, recorded with name, title, date and time, constitutes signature of this Agreement in terms of the Electronic Communications and Transactions Act 25 of 2002.$nda$,
  true, null
where not exists (select 1 from public.compliance_documents where kind = 'nda');

insert into public.compliance_documents (kind, version, title, summary, body, blocks_portal, created_by)
select 'agency_agreement', 1, 'Agency Agreement',
  'How ExPac appoints you to handle shipments on its behalf: responsibilities, charges and liability.',
  $agency$DRAFT - FOR LEGAL REVIEW BEFORE PUBLISHING

## 1. Parties
This Agency Agreement is entered into between [ExPac legal entity name], registration number [number] ("ExPac"), and the partner company accepting this Agreement in the ExPac Partner Portal ("the Agent").

## 2. Appointment
ExPac may, from time to time, appoint the Agent to perform services for shipments handed to it through the Partner Portal, including origin handling, collection, transport, customs clearance, destination handling and delivery ("the Services"). Each shipment handed over and accepted in the Partner Portal is a separate instruction under this Agreement. The appointment is non-exclusive.

## 3. Acceptance of instructions
The Agent shall accept or decline each shipment in the Partner Portal promptly. Once accepted, the Agent shall perform the Services with due skill, care and diligence, in line with industry practice and all applicable laws, customs and safety regulations.

## 4. Updates and documents
The Agent shall keep the shipment up to date in the Partner Portal, including milestones, delays, and documents such as booking confirmations, transport documents, proof of delivery and release notes, within [24] hours of each event.

## 5. Customers
ExPac's customers remain ExPac's customers. The Agent shall not invoice, quote or solicit them directly, and shall refer any approach by them to ExPac. The Non-Disclosure Agreement accepted in the Partner Portal forms part of this Agreement.

## 6. Charges and invoicing
The Agent's charges are those agreed in its rate sheet or quotation to ExPac for the shipment. The Agent shall invoice ExPac through the Partner Portal per shipment, with supporting documents. ExPac shall pay approved invoices within [30] days of month end, unless otherwise agreed in writing. Charges not agreed in advance require ExPac's written approval.

## 7. Liability and insurance
The Agent is liable for loss of or damage to cargo, and for delay, while the cargo is in its care, to the extent set out in the applicable international conventions or the Agent's standard trading conditions, whichever applies by law. The Agent shall hold adequate liability insurance for the Services and provide proof on request.

## 8. Sub-contracting
The Agent may not sub-contract the Services without ExPac's consent, and remains responsible for its sub-contractors.

## 9. Compliance
The Agent shall comply with all applicable laws, including customs, sanctions, anti-bribery and anti-corruption laws, and POPIA.

## 10. Term and termination
This Agreement continues until terminated by either party on [30] days' written notice, or immediately for material breach. Shipments already accepted shall be completed.

## 11. General
This Agreement is governed by the laws of the Republic of South Africa. Acceptance in the Partner Portal by an authorised representative of the Agent, recorded with name, title, date and time, constitutes signature of this Agreement.$agency$,
  false, null
where not exists (select 1 from public.compliance_documents where kind = 'agency_agreement');

insert into public.compliance_documents (kind, version, title, summary, body, blocks_portal, created_by)
select 'terms', 1, 'Terms & Conditions',
  'The terms that apply to your use of the ExPac Partner Portal and the work ExPac gives you.',
  $terms$DRAFT - FOR LEGAL REVIEW BEFORE PUBLISHING

## 1. Application
These Terms & Conditions apply to every partner company using the ExPac Partner Portal and to all services it performs for [ExPac legal entity name] ("ExPac"). Where these Terms conflict with a signed Agency Agreement, the Agency Agreement prevails.

## 2. Portal access
Access to the Partner Portal is personal to each login. The Partner shall keep its logins secure, ensure each user is an employee authorised to act for it, and remove users who leave. The Partner is responsible for everything done through its logins.

## 3. Information
The Partner shall ensure that all updates, documents, quotations and invoices it submits through the Partner Portal are accurate and complete. ExPac may rely on them when informing its customers.

## 4. Quotations and rates
Quotations and rate sheets submitted through the Partner Portal are binding for their stated validity. ExPac may accept or decline any quotation.

## 5. Invoices and payment
Invoices must be submitted through the Partner Portal, per shipment, with the invoice document attached. ExPac may query an invoice; the query must be answered before it is approved. Approved invoices are paid on the agreed terms.

## 6. Shipments the Partner sends to ExPac
Where the Partner sends ExPac its own shipment through the Partner Portal, the Partner is ExPac's customer for that shipment and is billed by ExPac on the terms of ExPac's quotation, ExPac's standard trading conditions and any approved credit facility.

## 7. Liability
Save as provided in the Agency Agreement or by law, neither party is liable to the other for indirect or consequential loss. ExPac is not liable for any interruption of the Partner Portal.

## 8. Changes
ExPac may update these Terms by publishing a new version in the Partner Portal. The Partner will be asked to accept the new version.

## 9. Governing law
These Terms are governed by the laws of the Republic of South Africa.$terms$,
  false, null
where not exists (select 1 from public.compliance_documents where kind = 'terms');

insert into public.compliance_documents (kind, version, title, summary, body, blocks_portal, created_by)
select 'credit_application', 1, 'Credit Application',
  'Apply for a credit facility for the shipments you send ExPac to handle.',
  $credit$DRAFT - FOR LEGAL REVIEW BEFORE PUBLISHING

## 1. Application
The applicant company ("the Applicant") applies to [ExPac legal entity name] ("ExPac") for a credit facility for services ExPac performs for it, on the details given in this application.

## 2. Declarations
The Applicant declares that the information in this application is true and complete, and that the person accepting it is authorised to do so on the Applicant's behalf.

## 3. Credit checks
The Applicant consents to ExPac obtaining credit information about it from credit bureaux, its bank and its trade references, and to ExPac sharing its payment record with credit bureaux, in line with POPIA and the National Credit Act where it applies.

## 4. Credit terms
ExPac may approve or decline this application, set a credit limit and payment terms, and change or withdraw the facility on written notice. Amounts not paid by the due date bear interest at [prime + 2]% per year. The Applicant is liable for ExPac's collection costs on the attorney and own client scale.

## 5. Disbursements
Duties, VAT and other disbursements paid by ExPac on the Applicant's behalf may be payable before release of the cargo, whether or not a credit facility is approved.

## 6. Lien
ExPac has a general lien over all goods and documents of the Applicant in its possession for all amounts owed to it.

## 7. Governing law
This application and any facility are governed by the laws of the Republic of South Africa.$credit$,
  false, null
where not exists (select 1 from public.compliance_documents where kind = 'credit_application');

notify pgrst, 'reload schema';
