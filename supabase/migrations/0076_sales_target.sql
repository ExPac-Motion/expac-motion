-- ============================================================
-- 0076  Per-salesperson Sales Target (VAT-inclusive) + Leads Target
-- ============================================================
-- Adds profiles.sales_target, sitting alongside the existing
-- sales_revenue_target (excl. VAT) and sales_gp_target -- lets Sales Person
-- show a target for the new "Total Sales" figure (Grand Total incl. VAT)
-- the same way Revenue and Gross Profit already have their own targets.
--
-- Also adds profiles.leads_target: a per-rep monthly new-leads target,
-- mirroring company_settings.sales_new_leads_target but scoped to one rep.
--
-- Run in the Supabase SQL editor. Self-contained & idempotent.

alter table public.profiles add column if not exists sales_target numeric not null default 0;
alter table public.profiles add column if not exists leads_target numeric not null default 0;
