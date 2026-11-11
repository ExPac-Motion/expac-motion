-- ============================================================
-- 0238  Container seal number on the quotation and the shipment
-- ============================================================
-- quotes.seal_no / jobs.seal_no, kept in step both ways like Container No
-- (0198): editing either side copies it across. Own small triggers, so the
-- 0198 sync functions are unchanged. A new shipment from a quote picks the
-- quote's seal up.
--
-- Run in the Supabase SQL editor after 0237. Self-contained & idempotent.

alter table public.quotes add column if not exists seal_no text;
alter table public.jobs   add column if not exists seal_no text;

-- Quote -> shipment (direct edits only, not the echo of a shipment edit).
create or replace function public.sync_quote_seal_to_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.seal_no is not distinct from old.seal_no then
    return null;
  end if;
  update public.jobs set seal_no = nullif(btrim(coalesce(new.seal_no, '')), '')
   where quote_id = new.id;
  return null;
end;
$$;

drop trigger if exists trg_quote_seal_sync on public.quotes;
create trigger trg_quote_seal_sync
  after update of seal_no on public.quotes
  for each row execute function public.sync_quote_seal_to_job();

-- Shipment -> quote.
create or replace function public.sync_job_seal_to_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.quote_id is null or pg_trigger_depth() > 1
     or new.seal_no is not distinct from old.seal_no then
    return null;
  end if;
  update public.quotes set seal_no = nullif(btrim(coalesce(new.seal_no, '')), '')
   where id = new.quote_id;
  return null;
end;
$$;

drop trigger if exists trg_job_seal_sync on public.jobs;
create trigger trg_job_seal_sync
  after update of seal_no on public.jobs
  for each row execute function public.sync_job_seal_to_quote();

-- New shipment from a quote: take the quote's seal.
create or replace function public.job_seal_from_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seal_no is null and new.quote_id is not null then
    select nullif(btrim(coalesce(q.seal_no, '')), '') into new.seal_no
      from public.quotes q where q.id = new.quote_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_job_seal_from_quote on public.jobs;
create trigger trg_job_seal_from_quote
  before insert on public.jobs
  for each row execute function public.job_seal_from_quote();

notify pgrst, 'reload schema';
