-- When a quote was sent / marked Not Proceeding, for the Sales CRM
-- "Quote Win Rate" and "Quote Turnaround" widgets. Stamped by trigger on
-- any status change (Quote Builder, list dropdown, Bulk Edit, Comms), so no
-- app path can forget it. Only the first time each status is reached.
--
-- Run in the Supabase SQL editor after 0110. Self-contained & idempotent.

alter table public.quotes
  add column if not exists sent_at timestamptz,
  add column if not exists lost_at timestamptz;

create or replace function public.stamp_quote_status_times()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'sent' and new.sent_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'sent') then
    new.sent_at := now();
  end if;
  if new.status = 'lost' and new.lost_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'lost') then
    new.lost_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quote_status_times on public.quotes;
create trigger trg_quote_status_times
  before insert or update of status on public.quotes
  for each row
  execute function public.stamp_quote_status_times();

-- Backfill lost quotes with their last-updated time (best available).
-- sent_at is NOT backfilled: there is no reliable past send time, and a
-- guessed one would skew the turnaround median — it fills from now on.
update public.quotes
   set lost_at = updated_at
 where status = 'lost' and lost_at is null;

notify pgrst, 'reload schema';
