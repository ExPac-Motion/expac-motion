-- ============================================================
-- 0067  Backfill blank job shipment fields from their linked quote
-- ============================================================
-- accept_quote() only ever copies origin/destination/AWB-MBL/container/
-- ETD/ETA/carrier/vessel from a quote onto its job ONCE, at the moment
-- the quote is accepted (every version since 0001 works this way). If
-- those fields were still blank on the quote at that moment, the job was
-- created with nulls, and there's no later re-sync -- so editing the
-- quote afterwards (e.g. filling in the route) never reaches the job
-- (e.g. SEA675789: quote has origin/destination, job doesn't).
--
-- Same one-way backfill pattern as the shipping_line fix in 0058
-- (blanks only -- never overwrites a value already set on the job).
--
-- Run in the Supabase SQL editor after 0066. Self-contained & idempotent.

update public.jobs j
   set origin = q.origin
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.origin, '') is null
   and nullif(q.origin, '') is not null;

update public.jobs j
   set destination = q.destination
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.destination, '') is null
   and nullif(q.destination, '') is not null;

update public.jobs j
   set awb_mbl = case
     when q.mode ilike 'air%' or q.mode ilike 'courier%'
       then coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''))
     else coalesce(nullif(q.mbl_no, ''), nullif(q.hbl_no, ''))
   end
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.awb_mbl, '') is null
   and coalesce(nullif(q.mawb_no, ''), nullif(q.hawb_no, ''),
                nullif(q.mbl_no, ''), nullif(q.hbl_no, '')) is not null;

update public.jobs j
   set container_no = q.container_no
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.container_no, '') is null
   and nullif(q.container_no, '') is not null;

update public.jobs j
   set etd = q.etd
  from public.quotes q
 where j.quote_id = q.id
   and j.etd is null
   and q.etd is not null;

update public.jobs j
   set eta = q.eta
  from public.quotes q
 where j.quote_id = q.id
   and j.eta is null
   and q.eta is not null;

update public.jobs j
   set carrier_name = q.carrier_name
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.carrier_name, '') is null
   and nullif(q.carrier_name, '') is not null;

update public.jobs j
   set vessel_name = q.vessel_name
  from public.quotes q
 where j.quote_id = q.id
   and nullif(j.vessel_name, '') is null
   and nullif(q.vessel_name, '') is not null;
