-- Routing and Transit Time for Air Freight shipment documents (Document Vault).
-- Free text, typed on the Quote Builder; saved with the same direct update as
-- voyage_no (0107) after save_quote, and printed after Flight Date.
--
-- Run in the Supabase SQL editor after 0107. Self-contained & idempotent.

alter table public.quotes
  add column if not exists routing      text,
  add column if not exists transit_time text;
