-- Voyage No for Sea Freight shipment documents (Document Vault).
-- Typed on the Quote Builder next to Sales Person; saved with a direct update
-- after save_quote (the RPC signature is unchanged) and read by the shipment
-- print documents from the linked quote.
--
-- Run in the Supabase SQL editor after 0106. Self-contained & idempotent.

alter table public.quotes
  add column if not exists voyage_no text;
