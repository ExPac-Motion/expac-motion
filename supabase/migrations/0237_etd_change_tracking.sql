-- ============================================================
-- 0237  Active Shipments: see when the ETD moved (as 0234 does for ETA)
-- ============================================================
-- jobs.etd_prev / etd_changed_at / etd_changed_source: on every ETD
-- change, the date it replaced, when, and "tracking" (no signed-in user:
-- the tracking webhook / cron) or "manual". Shown on the board when you
-- hover the ETD calendar icon. History starts from when this runs.
--
-- Run in the Supabase SQL editor after 0236. Self-contained & idempotent.

alter table public.jobs
  add column if not exists etd_prev            date,
  add column if not exists etd_changed_at      timestamptz,
  add column if not exists etd_changed_source  text;

create or replace function public.jobs_etd_change()
returns trigger
language plpgsql
as $$
begin
  if new.etd is distinct from old.etd then
    new.etd_prev := old.etd;
    new.etd_changed_at := now();
    new.etd_changed_source := case when auth.uid() is null then 'tracking' else 'manual' end;
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_etd_change on public.jobs;
create trigger jobs_etd_change
  before update of etd on public.jobs
  for each row execute function public.jobs_etd_change();

notify pgrst, 'reload schema';
