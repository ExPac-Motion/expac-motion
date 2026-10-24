-- ============================================================
-- Security check (READ-ONLY): run in the Supabase SQL editor any time.
-- ============================================================
-- Checks the LIVE database, not the migration files, so anything changed
-- by hand in the dashboard shows up too. Every query should return
-- NO ROWS. The SQL editor only shows the last result, so run them one at a
-- time (select a query, then Run selected).

-- 1. Tables in the app's schema with row level security switched OFF
--    (anyone with the public key could read / write them).
select c.relname as table_without_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 1;

-- 2. Policies open to every signed-in user or to anonymous visitors with no
--    condition (USING / WITH CHECK true), outside the known public ones.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
  from pg_policies
 where (qual = 'true' or with_check = 'true')
   and not (schemaname = 'storage' and policyname in (
     'mail-assets public read',
     'web-form-uploads public write'))
 order by 1, 2, 3;

-- 3. Elevated (security definer) functions anonymous visitors can call,
--    outside the ones the public pages need.
select p.proname as anon_callable_function
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and has_function_privilege('anon', p.oid, 'execute')
   and p.prorettype <> 'trigger'::regtype
   and p.proname not in (
     'check_client_invite', 'track_shipment', 'get_web_form', 'submit_web_form',
     'submit_quote_request', 'unsubscribe_lead', 'get_partner_invite',
     -- helpers that only return rows for the caller (null / false for anon)
     'is_staff', 'is_admin', 'has_perm', 'my_client_id', 'in_portal_preview',
     'can_see_accounts', 'can_use_wms', 'can_use_inbox', 'my_partner_kind',
     'my_party_client_id', 'my_partner_id', 'my_partner', 'partner_company')
 order by 1;

-- 4. Logins with no profile row (they get no access since 0185, but
--    shouldn't exist: delete them in Authentication > Users).
select u.email, u.created_at
  from auth.users u left join public.profiles p on p.id = u.id
 where p.id is null;

-- 5. Staff logins (Admin / Standard User): check every one is someone you
--    know. (This one DOES return rows: review them, don't expect none.)
select p.full_name, p.email, p.role, u.last_sign_in_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.role in ('admin', 'user')
 order by p.role, p.full_name;
