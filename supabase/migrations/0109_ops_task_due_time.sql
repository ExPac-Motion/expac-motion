-- Due time for Operations Tasks & Notes (optional, alongside due_date).
-- 24-hour time of day; the app shows/enters it as HH:MM.
--
-- Run in the Supabase SQL editor after 0108. Self-contained & idempotent.

alter table public.ops_tasks
  add column if not exists due_time time;
