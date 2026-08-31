-- EXPAC Rate Desk — initial schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query) or via `supabase db push`.
-- Single-tenant: every authenticated user is an ExPac team member and sees all company data.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- Profiles (one row per auth user)
-- ============================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Clients & Suppliers
-- ============================================================
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  company    text not null,
  contact    text,
  email      text,
  phone      text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  company    text not null,
  contact    text,
  email      text,
  phone      text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Quotes + charge lines
-- ============================================================
create table if not exists public.quotes (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null,
  client_id      uuid references public.clients (id) on delete set null,
  supplier_id    uuid references public.suppliers (id) on delete set null,
  mode           text not null default 'Air'
                 check (mode in ('Air', 'Sea FCL', 'Sea LCL', 'Road')),
  commodity      text,
  origin         text,
  destination    text,
  delivery_terms text,
  valid_until    date,
  status         text not null default 'draft'
                 check (status in ('draft', 'sent', 'followup', 'accepted')),
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.quote_lines (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
  position    int  not null default 0,
  description text not null default '',
  qty         numeric not null default 1,
  buy         numeric not null default 0,
  sell        numeric not null default 0
);
create index if not exists quote_lines_quote_id_idx on public.quote_lines (quote_id);

-- ============================================================
-- Jobs + milestone history
-- ============================================================
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid references public.quotes (id) on delete set null,
  reference   text not null,
  client_id   uuid references public.clients (id) on delete set null,
  origin      text,
  destination text,
  mode        text not null default 'Air'
              check (mode in ('Air', 'Sea FCL', 'Sea LCL', 'Road')),
  milestone   text not null default 'Booked'
              check (milestone in ('Booked', 'In Transit', 'Customs', 'Delivered')),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.job_events (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  milestone  text not null
             check (milestone in ('Booked', 'In Transit', 'Customs', 'Delivered')),
  note       text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists job_events_job_id_idx on public.job_events (job_id);

-- ============================================================
-- RPC: save a quote and replace its charge lines atomically
-- ============================================================
create or replace function public.save_quote(
  p_id             uuid,
  p_reference      text,
  p_client_id      uuid,
  p_supplier_id    uuid,
  p_mode           text,
  p_commodity      text,
  p_origin         text,
  p_destination    text,
  p_delivery_terms text,
  p_valid_until    date,
  p_status         text,
  p_lines          jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.quotes
      (reference, client_id, supplier_id, mode, commodity, origin,
       destination, delivery_terms, valid_until, status)
    values
      (p_reference, p_client_id, p_supplier_id, p_mode, p_commodity, p_origin,
       p_destination, p_delivery_terms, p_valid_until, p_status)
    returning id into v_id;
  else
    update public.quotes set
      reference      = p_reference,
      client_id      = p_client_id,
      supplier_id    = p_supplier_id,
      mode           = p_mode,
      commodity      = p_commodity,
      origin         = p_origin,
      destination    = p_destination,
      delivery_terms = p_delivery_terms,
      valid_until    = p_valid_until,
      status         = p_status,
      updated_at     = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Quote % not found', p_id;
    end if;
  end if;

  delete from public.quote_lines where quote_id = v_id;

  insert into public.quote_lines (quote_id, position, description, qty, buy, sell)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(line ->> 'description', ''),
    coalesce((line ->> 'qty')::numeric, 0),
    coalesce((line ->> 'buy')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  return v_id;
end;
$$;

-- ============================================================
-- RPC: accept a quote -> create linked job (idempotent)
-- ============================================================
create or replace function public.accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id uuid;
  q        public.quotes%rowtype;
begin
  select * into q from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Quote % not found', p_quote_id;
  end if;

  update public.quotes
     set status = 'accepted', updated_at = now()
   where id = p_quote_id;

  select id into v_job_id from public.jobs where quote_id = p_quote_id limit 1;

  if v_job_id is null then
    insert into public.jobs
      (quote_id, reference, client_id, origin, destination, mode, milestone)
    values
      (q.id, q.reference, q.client_id, q.origin, q.destination, q.mode, 'Booked')
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;

-- ============================================================
-- RPC: advance a job milestone + log the change
-- ============================================================
create or replace function public.set_job_milestone(
  p_job_id    uuid,
  p_milestone text,
  p_note      text default null
)
returns void
language plpgsql
security invoker
as $$
begin
  update public.jobs set milestone = p_milestone where id = p_job_id;
  if not found then
    raise exception 'Job % not found', p_job_id;
  end if;

  insert into public.job_events (job_id, milestone, note)
  values (p_job_id, p_milestone, p_note);
end;
$$;

-- ============================================================
-- Row Level Security — any authenticated user has full access
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.clients      enable row level security;
alter table public.suppliers    enable row level security;
alter table public.quotes       enable row level security;
alter table public.quote_lines  enable row level security;
alter table public.jobs         enable row level security;
alter table public.job_events   enable row level security;

-- profiles: readable by any signed-in user, each user updates only their own row
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
create policy "profiles read"   on public.profiles for select to authenticated using (true);
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'suppliers', 'quotes', 'quote_lines', 'jobs', 'job_events'
  ]
  loop
    execute format('drop policy if exists "team full access" on public.%I;', t);
    execute format(
      'create policy "team full access" on public.%I
         for all to authenticated using (true) with check (true);', t);
  end loop;
end;
$$;
