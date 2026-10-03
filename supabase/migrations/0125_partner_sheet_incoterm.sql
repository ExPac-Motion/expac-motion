-- ============================================================
-- 0125  Partner rate sheets: incoterm
-- ============================================================
-- Each partner rate sheet records the basis the partner quotes on (EXW,
-- FOB …). It decides which of their sections the sheet prices — e.g. an
-- agent's FOB rates carry freight only, no Ex-Works charges. FOB Charges
-- are ExPac's own (added on the tier sheet / quote), never on a partner sheet.
--
-- Run in the Supabase SQL editor after 0124. Self-contained & idempotent.

alter table public.partner_rate_sheets
  add column if not exists incoterm text not null default 'EXW';

notify pgrst, 'reload schema';
