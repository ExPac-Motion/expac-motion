-- ============================================================
-- 0120  Rates & partner buy rates: admin only
-- ============================================================
-- Buy rates, margins and partner rate sheets are visible to and editable
-- by the admin account only — no other staff login, and never a customer
-- portal login. partner_rate_structures (0114) was open to every
-- authenticated account (portal logins included) and is closed here too.
--
-- The customer portal's Tariff Sheet reads the client_rate_sheet view (0071),
-- which runs with the view owner's rights and only exposes sell prices, so
-- it keeps working.
--
-- Also closes two internal tables that were open to every authenticated
-- account (portal logins included) to staff only: quote_messages (0102,
-- quotation emails) and notification_state (0078).
--
-- Run in the Supabase SQL editor after 0119. Self-contained & idempotent.

do $$
declare
  t text;
begin
  foreach t in array array[
    'rate_sheet', 'partner_rate_structures', 'partner_rate_sheets', 'tariff_sheets'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "team full access" on public.%I', t);
    execute format('drop policy if exists "admin only" on public.%I', t);
    execute format(
      'create policy "admin only" on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())', t);
  end loop;

  foreach t in array array['quote_messages', 'notification_state']
  loop
    execute format('drop policy if exists "team full access" on public.%I', t);
    execute format(
      'create policy "team full access" on public.%I for all to authenticated
         using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
