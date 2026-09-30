-- Backfill quotes.sent_at (added in 0111, stamped only from then on) from the
-- first outgoing Quotation Comms email for each quote — a real send time,
-- unlike a guess from updated_at. Only quotes that reached Sent or beyond,
-- and only where sent_at is still empty. Quotes sent outside the app
-- (e.g. straight from Outlook) have no record and stay empty.
--
-- Run in the Supabase SQL editor after 0111. Idempotent.

update public.quotes q
   set sent_at = m.first_sent
  from (
    select quote_id, min(coalesce(sent_at, created_at)) as first_sent
      from public.quote_messages
     where direction = 'out'
       and status not in ('draft', 'failed')
     group by quote_id
  ) m
 where m.quote_id = q.id
   and q.sent_at is null
   and q.status in ('sent', 'accepted', 'completed', 'lost');
