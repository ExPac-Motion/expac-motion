-- ============================================================
-- 0166  Shipment status history (portal progress bar)
-- ============================================================
-- Every change of jobs.shipment_status (Created, Booked, Collected,
-- Received, Loaded, Departed, In Transit, Arrived, Unloaded, Customs,
-- Detained, Released, On-Delivery, Delivered) is recorded with its date /
-- time, so the portal's progress bar can show each status with when it
-- was set. Past changes are backfilled from the milestone log
-- (job_events notes 'Shipment Status set to "..."').
--
-- Run in the Supabase SQL editor after 0165. Self-contained & idempotent.

create table if not exists public.job_status_history (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  status      text not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references auth.users (id) on delete set null default auth.uid()
);
create index if not exists job_status_history_job_idx on public.job_status_history (job_id, changed_at);

alter table public.job_status_history enable row level security;
drop policy if exists "team read" on public.job_status_history;
create policy "team read" on public.job_status_history
  for select to authenticated using (public.can_see_accounts());

create or replace function public.log_job_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shipment_status is not null and btrim(new.shipment_status) <> ''
     and (tg_op = 'INSERT' or new.shipment_status is distinct from old.shipment_status) then
    insert into public.job_status_history (job_id, status) values (new.id, btrim(new.shipment_status));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_job_status on public.jobs;
create trigger trg_log_job_status after insert or update of shipment_status on public.jobs
  for each row execute function public.log_job_status();

-- Backfill (once): status changes the milestone log already noted.
insert into public.job_status_history (job_id, status, changed_at, changed_by)
select e.job_id, substring(e.note from 'Shipment Status set to "([^"]+)"'), e.created_at, e.created_by
from public.job_events e
where e.note like 'Shipment Status set to "%'
  and not exists (select 1 from public.job_status_history h where h.job_id = e.job_id);

-- Portal: the customer's own shipments.
create or replace view public.client_job_status_history
with (security_barrier = true) as
select h.id, h.job_id, h.status, h.changed_at
from public.job_status_history h
join public.jobs j on j.id = h.job_id
where j.client_id = public.my_client_id();
grant select on public.client_job_status_history to authenticated;

notify pgrst, 'reload schema';
