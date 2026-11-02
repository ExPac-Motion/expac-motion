-- ============================================================
-- 0210  Team departments: Sales Ops, Support, Accounting, BDRs
-- ============================================================
-- Settings › Team listed every login (customers and partners too) as the
-- team. Staff logins now carry a department, and Team shows the ExPac team
-- grouped by it, with portal logins in their own section.
--
-- Only an Admin can set or change a department (the profiles update
-- policy lets any staff login edit profiles, 0026). The SQL editor
-- (no signed-in user) can too.
--
-- Run in the Supabase SQL editor after 0209. Self-contained & idempotent.

alter table public.profiles
  add column if not exists department text
  check (department is null or department in ('sales_ops', 'support', 'accounting', 'bdr'));

create or replace function public.protect_profile_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.department is distinct from old.department and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an Admin can change a team member''s department';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_department on public.profiles;
create trigger trg_protect_profile_department
  before update of department on public.profiles
  for each row execute function public.protect_profile_department();

notify pgrst, 'reload schema';
