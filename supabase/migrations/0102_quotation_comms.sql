-- ============================================================
-- 0102  Quotation Comms — same Comms-panel method as Shipments, for quotes
-- ============================================================
-- Mirrors 0062/0070 (shipment_comms/shipment_replies) and 0019/0069
-- (messages) but for quotations. Kept as a parallel table rather than a
-- nullable job_id/quote_id split on the existing messages table, so none
-- of the live Shipment Comms queries/RLS are touched.
--
-- Run in the Supabase SQL editor after 0101. Self-contained & idempotent.

alter table public.company_settings
  add column if not exists quotation_comms jsonb not null default '{}'::jsonb,
  add column if not exists quotation_replies jsonb not null default '{}'::jsonb;

create table if not exists public.quote_messages (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes (id) on delete cascade,
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
  sent_at     timestamptz,
  read_at     timestamptz
);

create index if not exists quote_messages_quote_created_idx
  on public.quote_messages (quote_id, created_at);
create index if not exists quote_messages_provider_idx
  on public.quote_messages (provider_id);

alter table public.quote_messages enable row level security;
drop policy if exists "team full access" on public.quote_messages;
create policy "team full access" on public.quote_messages
  for all to authenticated using (true) with check (true);
