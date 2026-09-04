-- ============================================================
-- 0018  Operations Control Tower — Live Tracking (ShipsGo)
-- ============================================================
-- 1. jobs.container_no  — the ocean container number (air jobs use awb_mbl).
--    Backfilled from the linked quote; accept_quote() now seeds it too.
-- 2. job_tracking       — one cached ShipsGo pull per job. Written by the
--    client after the /api/track Cloudflare Pages Function returns a
--    normalised payload. RLS: team full access.
--
-- Run in the Supabase SQL editor after 0017. Self-contained & idempotent.

-- ---- 1. jobs.container_no --------------------------------------------
alter table public.jobs
  add column if not exists container_no text;

update public.jobs j
   set container_no = q.container_no
  from public.quotes q
 where j.quote_id = q.id
   and (j.container_no is null or j.container_no = '')
   and coalesce(q.container_no, '') <> '';

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
      (quote_id, reference, client_id, supplier_id, origin, destination,
       mode, milestone, shipment_status, etd, eta, awb_mbl, container_no)
    values
      (q.id, q.reference, q.client_id, q.supplier_id, q.origin, q.destination,
       q.mode, 'Booked', 'Booked', q.etd, q.eta,
       case
         when q.mode like 'Air%' or q.mode like 'Courier%'
           then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
         when q.mode like 'Sea%'
           then coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
         else null
       end,
       nullif(q.container_no, ''))
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;

-- ---- 2. job_tracking ------------------------------------------------
create table if not exists public.job_tracking (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null unique references public.jobs (id) on delete cascade,
  ref_type   text,                 -- 'ocean' | 'air'
  ref_value  text,                 -- container / AWB / MBL actually tracked
  carrier    text,
  shipsgo_id text,                 -- ShipsGo's id for the shipment (reused on refresh)
  status     text,
  pol        text,
  pod        text,
  etd        date,
  eta        date,
  last_event text,
  movements  jsonb not null default '[]'::jsonb,
  raw        jsonb,
  synced_at  timestamptz,
  created_at timestamptz not null default now()
);

alter table public.job_tracking enable row level security;
drop policy if exists "team full access" on public.job_tracking;
create policy "team full access" on public.job_tracking
  for all to authenticated using (true) with check (true);
