-- ============================================================
-- 0077  Company-wide Sales Target + Cost of Sales Ratio target
-- ============================================================
-- Adds company_settings.sales_target (Total Sales/Grand Total incl. VAT
-- target, mirroring the per-rep sales_target on profiles) and
-- company_settings.cost_of_sales_target (%, default 85) -- the editable
-- version of the Cost of Sales Ratio card's target, previously hardcoded.
--
-- sales_revenue_target stays in the table (existing data, still read by
-- older code paths) but is no longer surfaced in the Edit Targets UI --
-- a flat revenue target doesn't fit a cost-ratio-driven margin model.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

alter table public.company_settings add column if not exists sales_target numeric not null default 0;
alter table public.company_settings add column if not exists cost_of_sales_target numeric not null default 85;
