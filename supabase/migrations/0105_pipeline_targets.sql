-- Overall (not per-stage) target for the two Sales CRM pipeline charts.
-- 0 means "no target set" -- the app falls back to scaling each stage's bar
-- against the pipeline's own current total, same as before this migration.
--
-- Run in the Supabase SQL editor after 0104. Self-contained & idempotent.

alter table public.company_settings
  add column if not exists opportunities_pipeline_target numeric not null default 0,
  add column if not exists quotes_pipeline_target numeric not null default 0;
