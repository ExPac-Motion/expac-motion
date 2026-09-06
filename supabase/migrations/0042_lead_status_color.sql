-- ============================================================
-- 0042  Sales CRM: lead status colours
-- ============================================================
-- A colour per lead status, shown as a swatch on the Lead Statuses page
-- and as a coloured badge on Opportunities pipeline cards.
--
-- Run in the Supabase SQL editor after 0041. Self-contained & idempotent.

alter table public.lead_statuses
  add column if not exists color text not null default '#64748b';

update public.lead_statuses set color = '#e11d48'
  where lower(name) = 'hot lead' and color = '#64748b';
update public.lead_statuses set color = '#16a34a'
  where lower(name) = 'active customer' and color = '#64748b';
update public.lead_statuses set color = '#94a3b8'
  where lower(name) = 'bad fit' and color = '#64748b';
