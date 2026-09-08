-- 0053  Quote status gains "completed" — quote statuses now line up 1:1
--       with the Opportunities pipeline stages.
--
--   open      -> New Lead            (pipeline: New Lead - Enquiries)
--   sent      -> Quote Sent          (pipeline: Quote Sent - Follow Up)
--   accepted  -> Quote Accepted      (pipeline: Quote Accepted - Active Shipment)
--   completed -> Completed           (pipeline: Completed - Shipment Delivered)  <-- NEW
--   lost      -> Not Proceeding      (pipeline: Not Proceeding - Keep In Contact)
--
-- "completed" is a won + terminal state (the deal was accepted and the
-- shipment has been delivered). Only the CHECK constraint changes here;
-- stored values and the 'open' default are untouched, and 'lost' keeps its
-- value (it is only relabelled to "Not Proceeding" in the UI).
--
-- Run in the Supabase SQL editor after 0052. Self-contained & idempotent.

alter table public.quotes drop constraint if exists quotes_status_check;

alter table public.quotes
  add constraint quotes_status_check
  check (status in ('open', 'sent', 'accepted', 'completed', 'lost'));
