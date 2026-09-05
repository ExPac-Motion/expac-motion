-- ============================================================
-- 0026  Customer Portal — client accounts + data isolation
-- ============================================================
-- Phase 2, module 6, final. Until now every "team full access" policy in
-- this app reads `using (true)` — any authenticated user sees everything,
-- which was safe because only ExPac staff could ever sign in. Adding real
-- client logins breaks that assumption, so this migration:
--
--   1. Adds a client-portal role to profiles (role='client' + client_id),
--      protected by a trigger so a client can never grant themselves staff
--      access by editing their own profile row.
--   2. Locks every existing "team full access" policy down to staff only
--      (public.is_staff()) — clients get ZERO access to base tables.
--   3. Adds "security barrier" views (client_quotes, client_quote_lines,
--      client_jobs, client_messages, client_documents) that run with the
--      view owner's privileges, not RLS pass-through, and hand-pick which
--      columns are safe to expose (no buy cost, no margin, no agent/
--      transporter/clearing-agent — the same separation the printed
--      quotation already enforces) filtered to the caller's own client_id.
--      This matters because a plain RLS SELECT policy on quote_lines would
--      let a client query the base table directly over the REST API and
--      pull buy/margin regardless of what the portal UI shows.
--   4. A claim-by-invite-token flow for provisioning client logins (no
--      service-role key needed in the browser): staff creates an invite
--      row, shares the link, the client signs up and calls
--      claim_client_invite() to attach their new account to that client.
--   5. client_send_message() lets a client send an outbound email-kind
--      message on their own shipment without any direct table access.
--
-- Run in the Supabase SQL editor after 0025. Self-contained & idempotent.

-- ---------- 1. Role plumbing ----------

alter table public.profiles
  add column if not exists client_id uuid references public.clients (id) on delete set null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'user', 'client'));

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role <> 'client' from public.profiles where id = auth.uid()),
    true -- no profile row yet (mid-signup) — never treat as a client by default
  );
$$;

create or replace function public.my_client_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from public.profiles where id = auth.uid();
$$;

-- A client can never edit their own role/client_id — only staff can. Runs
-- BEFORE the row changes, so is_staff() below still reflects the caller's
-- privilege level at the start of this update, not whatever they tried to
-- change it to.
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.role := old.role;
    new.client_id := old.client_id;
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_privileges on public.profiles;
create trigger protect_profile_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated using (public.is_staff() or id = auth.uid());

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles
  for update to authenticated
  using (public.is_staff() or id = auth.uid())
  with check (public.is_staff() or id = auth.uid());

-- ---------- 2. Lock every existing table down to staff only ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'suppliers', 'quotes', 'quote_lines', 'jobs', 'job_events',
    'agents', 'transporters', 'clearing_agents',
    'import_vat_duty', 'import_vat_duty_lines', 'packing_list_items',
    'ops_tasks', 'job_tracking', 'messages', 'company_settings',
    'shipment_documents', 'rate_sheet'
  ]
  loop
    execute format('drop policy if exists "team full access" on public.%I;', t);
    execute format(
      'create policy "team full access" on public.%I
         for all to authenticated using (public.is_staff()) with check (public.is_staff());', t);
  end loop;
end;
$$;

drop policy if exists "shipment-documents team access" on storage.objects;
create policy "shipment-documents team access" on storage.objects
  for all to authenticated
  using (bucket_id = 'shipment-documents' and public.is_staff())
  with check (bucket_id = 'shipment-documents' and public.is_staff());

-- ---------- 3. Client-safe views (security barrier — hand-picked columns) ----------

alter table public.shipment_documents
  add column if not exists visible_to_client boolean not null default false;

create or replace view public.client_quotes
with (security_barrier = true) as
select
  q.id, q.reference, q.client_id, q.mode, q.commodity, q.origin, q.destination,
  q.delivery_terms, q.valid_until, q.status, q.commercial_value,
  q.insurance_amount, q.vessel_name, q.mbl_no, q.hbl_no, q.container_no,
  q.etd, q.eta, q.incoterms, q.mawb_no, q.hawb_no, q.flight_no, q.flight_date,
  q.carrier_name, q.created_at,
  s.company as supplier_company
from public.quotes q
left join public.suppliers s on s.id = q.supplier_id
where q.client_id = public.my_client_id();

create or replace view public.client_quote_lines
with (security_barrier = true) as
select ql.id, ql.quote_id, ql.position, ql.category, ql.code, ql.description,
       ql.unit, ql.qty, ql.cur, ql.vat_pct, ql.sell
from public.quote_lines ql
join public.quotes q on q.id = ql.quote_id
where q.client_id = public.my_client_id();

create or replace view public.client_jobs
with (security_barrier = true) as
select j.id, j.reference, j.client_id, j.mode, j.milestone, j.shipment_status,
       j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name,
       j.carrier_name, j.provisional_delivery_date, j.etd, j.eta,
       j.origin, j.destination, j.created_at,
       s.company as supplier_company
from public.jobs j
left join public.suppliers s on s.id = j.supplier_id
where j.client_id = public.my_client_id();

create or replace view public.client_messages
with (security_barrier = true) as
select m.id, m.job_id, m.direction, m.to_emails, m.cc_emails, m.subject,
       m.body, m.status, m.created_at
from public.messages m
join public.jobs j on j.id = m.job_id
where j.client_id = public.my_client_id() and m.kind = 'email';

create or replace view public.client_documents
with (security_barrier = true) as
select sd.id, sd.job_id, sd.name, sd.storage_path, sd.kind, sd.doc_type,
       sd.size_bytes, sd.created_at
from public.shipment_documents sd
join public.jobs j on j.id = sd.job_id
where j.client_id = public.my_client_id() and sd.visible_to_client = true;

grant select on public.client_quotes, public.client_quote_lines,
  public.client_jobs, public.client_messages, public.client_documents
  to authenticated;

create policy "clients view shared documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'shipment-documents'
    and exists (
      select 1 from public.shipment_documents sd
      join public.jobs j on j.id = sd.job_id
      where sd.storage_path = storage.objects.name
        and sd.visible_to_client = true
        and j.client_id = public.my_client_id()
    )
  );

-- ---------- 4. Invite-based client provisioning (no service-role key needed) ----------

create table if not exists public.client_invites (
  token      uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  email      text,
  claimed_by uuid references auth.users (id),
  claimed_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.client_invites enable row level security;
drop policy if exists "staff manage invites" on public.client_invites;
create policy "staff manage invites" on public.client_invites
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- The signup page needs to confirm a token is real before asking for a
-- password, without yet being authenticated as anyone in particular.
drop policy if exists "anon read unclaimed invite" on public.client_invites;
create policy "anon read unclaimed invite" on public.client_invites
  for select to anon, authenticated using (claimed_at is null);

create or replace function public.claim_client_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from public.client_invites
   where token = p_token and claimed_at is null;
  if v_client_id is null then
    raise exception 'Invalid or already-used invite link';
  end if;
  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where token = p_token;
  update public.profiles set role = 'client', client_id = v_client_id
   where id = auth.uid();
end;
$$;

-- ---------- 5. Client-initiated messages, without direct table access ----------

create or replace function public.client_send_message(p_job_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.jobs where id = p_job_id and client_id = public.my_client_id()
  ) then
    raise exception 'Shipment not found';
  end if;
  -- direction='in' matches the existing convention (staff's CommsPanel shows
  -- 'in' as "Reply" — a message that came from the customer, not from ExPac).
  insert into public.messages (job_id, kind, direction, body, status)
  values (p_job_id, 'email', 'in', p_body, 'sent')
  returning id into v_id;
  return v_id;
end;
$$;
