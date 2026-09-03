-- ============================================================
-- 0008  Active Jobs inherit the full detail set from their quote
-- ============================================================
-- When a quote is accepted the job should start life pre-filled with
-- everything the quote already knows: ports, ETD, ETA and the master
-- transport document number. Operators then edit these in place as the
-- job runs.
--
-- Also backfills jobs that were created before their quote had this
-- detail captured (e.g. JOB810890, accepted before the LOCODE pickers
-- existed). Only NULL / blank job fields are filled, so any edit an
-- operator has already made on the board is preserved.
--
-- Run in the Supabase SQL editor after 0007. Self-contained & idempotent.

-- ---- Backfill existing jobs from their linked quote --------------------
update public.jobs j
   set origin      = coalesce(j.origin, q.origin),
       destination = coalesce(j.destination, q.destination),
       etd         = coalesce(j.etd, q.etd),
       eta         = coalesce(j.eta, q.eta)
  from public.quotes q
 where j.quote_id = q.id;

-- Master document number: MAWB for air / courier, MBL for sea.
update public.jobs j
   set awb_mbl = case
                   when q.mode like 'Air%' or q.mode like 'Courier%'
                     then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
                   when q.mode like 'Sea%'
                     then coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
                   else null
                 end
  from public.quotes q
 where j.quote_id = q.id
   and (j.awb_mbl is null or j.awb_mbl = '');

-- ---- accept_quote now seeds ports, dates and the doc number ----------
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
       mode, milestone, shipment_status, etd, eta, awb_mbl)
    values
      (q.id, q.reference, q.client_id, q.supplier_id, q.origin, q.destination,
       q.mode, 'Booked', 'Booked', q.etd, q.eta,
       case
         when q.mode like 'Air%' or q.mode like 'Courier%'
           then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
         when q.mode like 'Sea%'
           then coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
         else null
       end)
    returning id into v_job_id;

    insert into public.job_events (job_id, milestone, note)
    values (v_job_id, 'Booked', 'Job created from accepted quote');
  end if;

  return v_job_id;
end;
$$;
