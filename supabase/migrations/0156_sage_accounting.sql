-- ============================================================
-- 0156  Sage Business Cloud Accounting (South Africa), read-only sync
-- ============================================================
-- /api/sage-sync (Cloudflare Pages Function) pulls Sage customers, tax
-- invoices and customer receipts into the tables below every 30 minutes
-- (pg_cron) or on "Sync now" in Settings › Sage Accounting.
--
--   * clients.sage_customer_id links a Motion customer to its Sage customer
--     (picked on Customers › <customer> › Invoices & Account, or auto-matched
--     by an identical company name).
--   * An invoice's Reference is the Motion shipment number (jobs.reference):
--     the invoice links to that shipment, and the shipment's Invoiced /
--     Invoice No (0110) fill in when still blank.
--   * Staff (Admin / Standard User) read everything; a Customer Portal login
--     reads only its own customer's invoices and receipts, and only with the
--     "Invoices" portal permission. Only the sync (service role) writes.
--
-- Run in the Supabase SQL editor after 0155. Self-contained & idempotent.

-- ---------- 1. Who may see account data ----------
create or replace function public.can_see_accounts()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'user')
  );
$$;
grant execute on function public.can_see_accounts() to authenticated;

create or replace function public.my_invoices_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p
   where p.id = auth.uid() and p.role = 'client'
     and coalesce(p.portal_permissions ->> 'invoices', 'true') <> 'false';
$$;
grant execute on function public.my_invoices_client_id() to authenticated;

-- ---------- 2. Customer link ----------
alter table public.clients add column if not exists sage_customer_id bigint;
create unique index if not exists clients_sage_customer_uidx
  on public.clients (sage_customer_id) where sage_customer_id is not null;

-- ---------- 3. Synced tables ----------
create table if not exists public.sage_customers (
  sage_id        bigint primary key,
  name           text not null,
  email          text,
  tax_reference  text,
  balance        numeric,
  credit_limit   numeric,
  active         boolean,
  sage_modified  text,
  synced_at      timestamptz not null default now()
);

create table if not exists public.customer_invoices (
  sage_id           bigint primary key,
  sage_customer_id  bigint not null,
  client_id         uuid references public.clients (id) on delete set null,
  job_id            uuid references public.jobs (id) on delete set null,
  document_number   text,
  reference         text,
  invoice_date      date,
  due_date          date,
  exclusive         numeric,
  tax               numeric,
  total             numeric,
  amount_due        numeric,
  paid              boolean not null default false,
  status            text,
  sage_modified     text,
  synced_at         timestamptz not null default now()
);
create index if not exists customer_invoices_client_idx on public.customer_invoices (client_id);
create index if not exists customer_invoices_job_idx on public.customer_invoices (job_id);
create index if not exists customer_invoices_sage_customer_idx on public.customer_invoices (sage_customer_id);

create table if not exists public.customer_receipts (
  sage_id           bigint primary key,
  sage_customer_id  bigint not null,
  client_id         uuid references public.clients (id) on delete set null,
  document_number   text,
  reference         text,
  description       text,
  receipt_date      date,
  total             numeric,
  unallocated       numeric,
  sage_modified     text,
  synced_at         timestamptz not null default now()
);
create index if not exists customer_receipts_client_idx on public.customer_receipts (client_id);

create table if not exists public.sage_state (
  id               int primary key default 1 check (id = 1),
  company_id       bigint,
  company_name     text,
  last_sync_at     timestamptz,
  last_ok_at       timestamptz,
  last_error       text,
  invoices_since   text,
  receipts_since   text,
  customers        int,
  invoices         int,
  receipts         int,
  linked_customers int
);
insert into public.sage_state (id) values (1) on conflict (id) do nothing;

-- ---------- 4. RLS ----------
alter table public.sage_customers enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.customer_receipts enable row level security;
alter table public.sage_state enable row level security;

drop policy if exists "staff read" on public.sage_customers;
create policy "staff read" on public.sage_customers
  for select to authenticated using (public.can_see_accounts());

drop policy if exists "staff read" on public.sage_state;
create policy "staff read" on public.sage_state
  for select to authenticated using (public.can_see_accounts());

drop policy if exists "staff or own customer read" on public.customer_invoices;
create policy "staff or own customer read" on public.customer_invoices
  for select to authenticated
  using (public.can_see_accounts() or (client_id is not null and client_id = public.my_invoices_client_id()));

drop policy if exists "staff or own customer read" on public.customer_receipts;
create policy "staff or own customer read" on public.customer_receipts
  for select to authenticated
  using (public.can_see_accounts() or (client_id is not null and client_id = public.my_invoices_client_id()));

-- ---------- 5. Linking on every write ----------
create or replace function public.sage_invoice_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ref text := upper(btrim(coalesce(new.reference, '')));
begin
  select c.id into new.client_id from public.clients c
   where c.sage_customer_id = new.sage_customer_id limit 1;
  new.job_id := null;
  if ref <> '' then
    -- The shipment number exactly, else a shipment number inside the
    -- reference ("EXP1234 / PO 55"), longest first.
    select j.id into new.job_id from public.jobs j
     where upper(btrim(j.reference)) = ref limit 1;
    if new.job_id is null then
      select j.id into new.job_id from public.jobs j
       where length(btrim(j.reference)) >= 5
         and position(upper(btrim(j.reference)) in ref) > 0
       order by length(j.reference) desc limit 1;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sage_invoice_link on public.customer_invoices;
create trigger trg_sage_invoice_link before insert or update on public.customer_invoices
  for each row execute function public.sage_invoice_link();

-- The shipment's Invoiced / Invoice No fill in when still blank.
create or replace function public.sage_invoice_to_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_id is not null then
    update public.jobs
       set invoice_no  = coalesce(nullif(btrim(invoice_no), ''), new.document_number),
           invoiced_at = coalesce(invoiced_at, new.invoice_date)
     where id = new.job_id
       and (invoice_no is null or btrim(invoice_no) = '' or invoiced_at is null);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sage_invoice_to_job on public.customer_invoices;
create trigger trg_sage_invoice_to_job after insert or update on public.customer_invoices
  for each row execute function public.sage_invoice_to_job();

create or replace function public.sage_receipt_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.id into new.client_id from public.clients c
   where c.sage_customer_id = new.sage_customer_id limit 1;
  return new;
end;
$$;
drop trigger if exists trg_sage_receipt_link on public.customer_receipts;
create trigger trg_sage_receipt_link before insert or update on public.customer_receipts
  for each row execute function public.sage_receipt_link();

-- Re-pointing a customer at another Sage customer moves its rows.
create or replace function public.sage_client_relink()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.customer_invoices set client_id = null where client_id = new.id;
  update public.customer_receipts set client_id = null where client_id = new.id;
  if new.sage_customer_id is not null then
    update public.customer_invoices set client_id = new.id where sage_customer_id = new.sage_customer_id;
    update public.customer_receipts set client_id = new.id where sage_customer_id = new.sage_customer_id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sage_client_relink on public.clients;
create trigger trg_sage_client_relink after update of sage_customer_id on public.clients
  for each row when (old.sage_customer_id is distinct from new.sage_customer_id)
  execute function public.sage_client_relink();

-- ---------- 6. RPCs ----------
-- Link (or unlink, p_sage_id null) a Motion customer to a Sage customer.
create or replace function public.set_client_sage_customer(p_client uuid, p_sage_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  other text;
begin
  if not public.can_see_accounts() then
    raise exception 'Not allowed';
  end if;
  if p_sage_id is not null then
    select company into other from public.clients
     where sage_customer_id = p_sage_id and id <> p_client limit 1;
    if other is not null then
      raise exception 'That Sage customer is already linked to %', other;
    end if;
  end if;
  update public.clients set sage_customer_id = p_sage_id where id = p_client;
end;
$$;
grant execute on function public.set_client_sage_customer(uuid, bigint) to authenticated;

-- Links each unlinked Sage customer to the one Motion customer with the
-- identical company name (ignoring case / spaces). Returns how many.
create or replace function public.sage_auto_match()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  r record;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_see_accounts() then
    raise exception 'Not allowed';
  end if;
  for r in
    select s.sage_id, min(c.id::text)::uuid as client_id
      from public.sage_customers s
      join public.clients c
        on lower(regexp_replace(c.company, '\s+', ' ', 'g')) = lower(regexp_replace(btrim(s.name), '\s+', ' ', 'g'))
       and c.sage_customer_id is null
     where not exists (select 1 from public.clients x where x.sage_customer_id = s.sage_id)
     group by s.sage_id
    having count(*) = 1
  loop
    update public.clients set sage_customer_id = r.sage_id
     where id = r.client_id and sage_customer_id is null;
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function public.sage_auto_match() to authenticated, service_role;

-- The Sage customer behind a statement: staff for any customer, a portal
-- login only its own.
create or replace function public.sage_statement_target(p_client uuid)
returns table (sage_customer_id bigint, name text)
language plpgsql stable security definer set search_path = public as $$
declare
  cid uuid := case when public.can_see_accounts() then p_client else public.my_invoices_client_id() end;
begin
  return query
    select s.sage_id, s.name from public.clients c
      join public.sage_customers s on s.sage_id = c.sage_customer_id
     where c.id = cid;
end;
$$;
grant execute on function public.sage_statement_target(uuid) to authenticated;

-- The portal customer's own Sage balance.
create or replace function public.my_sage_account()
returns table (balance numeric, synced_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.balance, s.synced_at from public.clients c
    join public.sage_customers s on s.sage_id = c.sage_customer_id
   where c.id = public.my_invoices_client_id();
$$;
grant execute on function public.my_sage_account() to authenticated;

-- ---------- 7. Sync every 30 minutes ----------
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled, Sage syncs only on Sync now';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'sage-sync') then
    perform cron.unschedule('sage-sync');
  end if;
  perform cron.schedule(
    'sage-sync',
    '*/30 * * * *',
    $cron$
      select net.http_post(
        url := c.site_url || '/api/sage-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
      from private.follow_up_config c
      where c.site_url is not null and c.cron_secret is not null
      limit 1;
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
