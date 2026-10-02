-- ============================================================
-- 0115  quotes.copied: a duplicated quote not yet saved in the builder
-- ============================================================
-- Set when a quote is created by Duplicate (Quotations list or the
-- Shipments board). The first save in the Quote Builder resets the quote's
-- created_at (and its linked shipment's) to that day and clears the flag,
-- so a copy reads as created on the day it was actually finished.
--
-- Run in the Supabase SQL editor after 0114. Self-contained & idempotent.

alter table public.quotes
  add column if not exists copied boolean not null default false;
