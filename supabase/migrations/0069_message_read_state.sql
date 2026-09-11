-- ============================================================
-- 0069  Track read/unread on inbound (client) shipment messages
-- ============================================================
-- Staff currently only finds out a customer replied via the portal by
-- opening that shipment's Comms panel -- nothing on Active Shipments (or
-- anywhere else) flags it. Adds a read_at timestamp: null means unread.
-- Only ever meaningful for direction='in' (customer-authored) rows --
-- staff's own outbound messages are never "unread" by staff.
--
-- Existing rows are backfilled as already-read so this doesn't flood
-- everyone with "unread" badges for old history the moment it ships.
--
-- Run in the Supabase SQL editor after 0068.

alter table public.messages
  add column if not exists read_at timestamptz;

update public.messages
   set read_at = created_at
 where read_at is null;
