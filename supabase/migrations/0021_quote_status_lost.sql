-- ============================================================
-- 0021  Quote statuses: Draft/Sent/Follow-up/Accepted -> Open/Sent/Accepted/Lost
-- ============================================================
-- "Draft" is renamed to "Open"; "Follow-up" (a sub-stage of "sent, awaiting
-- the customer") folds into "Sent"; "Lost" is a new terminal status for a
-- quote the customer declined / didn't proceed with. Existing rows are
-- remapped so nothing is left in a status that no longer exists.
--
-- Run in the Supabase SQL editor after 0020. Self-contained & idempotent.

alter table public.quotes drop constraint if exists quotes_status_check;

update public.quotes set status = 'open' where status = 'draft';
update public.quotes set status = 'sent' where status = 'followup';

alter table public.quotes
  alter column status set default 'open';

alter table public.quotes
  add constraint quotes_status_check check (status in ('open', 'sent', 'accepted', 'lost'));
