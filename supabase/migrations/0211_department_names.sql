-- ============================================================
-- 0211  Team departments renamed
-- ============================================================
-- 0210's Sales Ops / Support / Accounting / BDRs become Management,
-- Support Division, Sales Division, Accounts Division and BDR Division.
-- Anyone already placed keeps their team under the new key
-- (sales_ops -> sales, accounting -> accounts; support and bdr stay).
--
-- Run in the Supabase SQL editor after 0210. Self-contained & idempotent.

-- The column's check constraint (unnamed in 0210), whatever it's called.
do $$
declare
  c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
     where con.conrelid = 'public.profiles'::regclass and con.contype = 'c' and att.attname = 'department'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;

update public.profiles set department = 'sales' where department = 'sales_ops';
update public.profiles set department = 'accounts' where department = 'accounting';

alter table public.profiles
  add constraint profiles_department_check
  check (department is null or department in ('management', 'support', 'sales', 'accounts', 'bdr'));

notify pgrst, 'reload schema';
