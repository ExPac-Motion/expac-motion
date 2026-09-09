-- ============================================================
-- 0056  A "won" quote always creates its shipment
-- ============================================================
-- Only the Accept button and the Opportunities pipeline call accept_quote().
-- Setting a quote to 'accepted'/'completed' any other way (Bulk Edit on the
-- Quotes list, a direct status change) flipped the status but never created
-- the job or promoted the lead — so the quote showed as won but never
-- appeared on Shipments (e.g. SEA498883).
--
-- This trigger runs accept_quote() whenever a quote's status crosses into a
-- won state by ANY path. It is guarded by "no job exists yet", which also
-- makes it safe against the re-entrant UPDATE that accept_quote() itself
-- does (by then the job exists, so the trigger is a no-op).
--
-- Run in the Supabase SQL editor after 0055. Self-contained & idempotent.

create or replace function public.on_quote_won()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.status in ('accepted', 'completed')
     and coalesce(old.status, '') not in ('accepted', 'completed')
     and not exists (select 1 from public.jobs where quote_id = new.id)
  then
    perform public.accept_quote(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_quote_won on public.quotes;
create trigger trg_quote_won
  after update of status on public.quotes
  for each row
  execute function public.on_quote_won();

-- One-off catch-up: won quotes that never got a shipment.
do $$
declare
  r record;
begin
  for r in
    select q.id
    from public.quotes q
    where q.status in ('accepted', 'completed')
      and not exists (select 1 from public.jobs j where j.quote_id = q.id)
  loop
    perform public.accept_quote(r.id);
  end loop;
end;
$$;
