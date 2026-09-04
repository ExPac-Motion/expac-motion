-- ============================================================
-- 0019  Shipment Comms — customer emails + private notes
-- ============================================================
-- 1. jobs: shipping_line / vessel_name / provisional_delivery_date, so the
--    Sea/Air email templates auto-fill and the values persist on the board.
-- 2. messages: one row per outbound email, inbound reply, or private note
--    against a shipment. Written by the client after functions/api/send-mail
--    returns a Resend id; RLS team full access.
--
-- Run in the Supabase SQL editor after 0018. Self-contained & idempotent.

-- ---- 1. jobs columns ----------------------------------------------
alter table public.jobs
  add column if not exists shipping_line             text,
  add column if not exists vessel_name               text,
  add column if not exists provisional_delivery_date date;

update public.jobs j
   set vessel_name = q.vessel_name
  from public.quotes q
 where j.quote_id = q.id
   and (j.vessel_name is null or j.vessel_name = '')
   and coalesce(q.vessel_name, '') <> '';

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
       mode, milestone, shipment_status, etd, eta, awb_mbl, container_no,
       vessel_name)
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
       nullif(q.container_no, ''),
       nullif(q.vessel_name, ''))
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;

-- ---- 2. messages ------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  kind        text not null default 'email',   -- 'email' | 'note'
  direction   text not null default 'out',     -- 'out' | 'in'
  to_emails   text[] not null default '{}',
  cc_emails   text[] not null default '{}',
  from_email  text,
  subject     text,
  body        text not null default '',
  remarks     text,
  status      text not null default 'sent',    -- draft|sent|failed|delivered|opened|bounced
  provider_id text,
  error       text,
  meta        jsonb,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists messages_job_created_idx
  on public.messages (job_id, created_at);
create index if not exists messages_provider_idx
  on public.messages (provider_id);

alter table public.messages enable row level security;
drop policy if exists "team full access" on public.messages;
create policy "team full access" on public.messages
  for all to authenticated using (true) with check (true);
