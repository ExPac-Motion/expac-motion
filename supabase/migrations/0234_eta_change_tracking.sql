-- ============================================================
-- 0234  Active Shipments: see when the ETA moved, and what the client knows
-- ============================================================
-- Live tracking writes the carrier's ETA onto the quote / shipment (0063,
-- 0101), but the board showed a plain date: no way to tell whether it was
-- live, when it moved, or whether the client was told the old date.
--
--   1. jobs.eta_prev / eta_changed_at / eta_changed_source: on every ETA
--      change, the date it replaced, when, and "tracking" (no signed-in user:
--      the tracking webhook / cron) or "manual".
--   2. jobs.eta_told / eta_told_at: the ETA on the shipment when the last
--      Shipment Comms email went to the client (messages, out + sent).
--      The board flags a shipment whose ETA no longer matches it.
--
-- Run in the Supabase SQL editor after 0233. Self-contained & idempotent.

alter table public.jobs
  add column if not exists eta_prev            date,
  add column if not exists eta_changed_at      timestamptz,
  add column if not exists eta_changed_source  text,
  add column if not exists eta_told            date,
  add column if not exists eta_told_at         timestamptz;

create or replace function public.jobs_eta_change()
returns trigger
language plpgsql
as $$
begin
  if new.eta is distinct from old.eta then
    new.eta_prev := old.eta;
    new.eta_changed_at := now();
    new.eta_changed_source := case when auth.uid() is null then 'tracking' else 'manual' end;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_eta_change on public.jobs;
create trigger jobs_eta_change
  before update of eta on public.jobs
  for each row execute function public.jobs_eta_change();

-- The ETA the client was last told: snapshot it whenever a Shipment Comms
-- email goes out.
create or replace function public.jobs_eta_told()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.job_id is not null and new.direction = 'out' and new.status = 'sent' and new.kind = 'email' then
    update public.jobs
       set eta_told = eta, eta_told_at = coalesce(new.sent_at, now())
     where id = new.job_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_eta_told on public.messages;
create trigger messages_eta_told
  after insert on public.messages
  for each row execute function public.jobs_eta_told();
