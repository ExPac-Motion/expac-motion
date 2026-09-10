-- ============================================================
-- 0063  Live tracking v2 — provider-neutral, webhook-driven
-- ============================================================
-- Replaces the manual ShipsGo "Refresh" model with a push feed:
--
--   1. jobs.scac                — carrier code, needed to register a
--                                 bill-of-lading / booking with a provider
--                                 (container numbers auto-detect the carrier).
--   2. job_tracking             — extended: provider + provider_ref, precise
--                                 pod_eta / pod_ata, vessel identity, and the
--                                 last known position + POL/POD coordinates
--                                 for the map. `tracking_status` tracks the
--                                 registration lifecycle (pending → registered
--                                 → failed). The legacy shipsgo_id column is
--                                 kept but unused.
--   3. tracking_events          — one row per carrier milestone (vessel
--                                 discharge, gate-out, rail ramp, …), written
--                                 by functions/api/tracking-webhook.ts with the
--                                 service-role key. Idempotent on
--                                 (job_id, provider, provider_event_id).
--   4. client_job_tracking /    — security-barrier views so a portal client
--      client_tracking_events     sees their own shipment's tracking + map
--                                 data, no buy cost / margin / internal parties.
--   5. Realtime                 — job_tracking + tracking_events added to the
--                                 supabase_realtime publication so the ops
--                                 board and the portal update the instant a
--                                 webhook lands.
--
-- Run in the Supabase SQL editor after 0062. Self-contained & idempotent.

-- ---------- 1. jobs.scac ----------
alter table public.jobs
  add column if not exists scac text;

-- ---------- 2. job_tracking columns ----------
alter table public.job_tracking
  add column if not exists provider        text not null default 'shipsgo',
  add column if not exists provider_ref    text,          -- provider's shipment id
  add column if not exists tracking_status text,           -- pending | registered | failed
  add column if not exists registered_at   timestamptz,
  add column if not exists vessel_name     text,
  add column if not exists vessel_imo      text,
  add column if not exists voyage          text,
  add column if not exists pod_eta         timestamptz,    -- precise, from the carrier
  add column if not exists pod_ata         timestamptz,    -- actual arrival
  add column if not exists pol_lat         double precision,
  add column if not exists pol_lon         double precision,
  add column if not exists pod_lat         double precision,
  add column if not exists pod_lon         double precision,
  add column if not exists vessel_lat      double precision,
  add column if not exists vessel_lon      double precision,
  add column if not exists position_at     timestamptz;

-- ---------- 3. tracking_events ----------
create table if not exists public.tracking_events (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs (id) on delete cascade,
  provider          text not null default 'shipsgo',
  provider_event_id text,
  event_code        text,
  description       text,
  location          text,
  locode            text,
  lat               double precision,
  lon               double precision,
  vessel_name       text,
  voyage            text,
  occurred_at       timestamptz,
  is_actual         boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (job_id, provider, provider_event_id)
);
create index if not exists tracking_events_job_idx
  on public.tracking_events (job_id, occurred_at);

alter table public.tracking_events enable row level security;
drop policy if exists "staff full access" on public.tracking_events;
create policy "staff full access" on public.tracking_events
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- 4. Portal views ----------
create or replace view public.client_job_tracking
with (security_barrier = true) as
select t.job_id, t.status, t.carrier, t.pol, t.pod, t.etd, t.eta,
       t.pod_eta, t.pod_ata, t.last_event, t.vessel_name, t.voyage,
       t.pol_lat, t.pol_lon, t.pod_lat, t.pod_lon,
       t.vessel_lat, t.vessel_lon, t.position_at, t.synced_at
from public.job_tracking t
join public.jobs j on j.id = t.job_id
where j.client_id = public.my_client_id();

create or replace view public.client_tracking_events
with (security_barrier = true) as
select e.id, e.job_id, e.event_code, e.description, e.location,
       e.lat, e.lon, e.vessel_name, e.voyage, e.occurred_at, e.is_actual
from public.tracking_events e
join public.jobs j on j.id = e.job_id
where j.client_id = public.my_client_id();

grant select on public.client_job_tracking, public.client_tracking_events
  to authenticated;

-- ---------- 5. Realtime ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.job_tracking;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.tracking_events;
  exception when duplicate_object then null;
  end;
end $$;
