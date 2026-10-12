-- ============================================================
-- 0163  New staff sign-ups start Restricted (no access)
-- ============================================================
-- Security fix before Customer Portal go-live. A login created from the
-- Motion sign-in page's "Create an account" (or straight against the
-- Supabase auth API with the public key, no metadata) got the column
-- default role 'user' = Standard User = full staff access. Anyone could
-- have signed up and read every customer, quote, cost, inbox mail and rate.
--
-- Now such a login is created as 'restricted' (sees the "account not
-- active" page, is_staff() false) until an admin sets its role in
-- Settings › Team. Portal ('client', pending) and partner sign-ups are
-- unchanged. Existing logins are not touched.
--
-- Run in the Supabase SQL editor after 0162. Self-contained & idempotent.

alter table public.profiles alter column role set default 'restricted';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'signup_kind' = 'portal' then
    insert into public.profiles
      (id, full_name, email, role, portal_status, requested_company)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      new.email,
      'client',
      'pending',
      nullif(trim(new.raw_user_meta_data ->> 'company'), '')
    )
    on conflict (id) do nothing;
  elsif new.raw_user_meta_data ->> 'signup_kind' = 'partner' then
    insert into public.profiles (id, full_name, email, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
      new.email,
      'partner'
    )
    on conflict (id) do nothing;
  else
    -- Staff: no access until an admin activates the login (Settings › Team).
    insert into public.profiles (id, full_name, email, role)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email, 'restricted')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- Logins created in the last 30 days, for the admin to review in Settings ›
-- Team (anyone unknown with Standard User / Admin should be set to
-- Restricted or deleted).
select p.full_name, p.email, p.role, u.created_at
  from public.profiles p join auth.users u on u.id = p.id
 where p.role in ('admin', 'user') and u.created_at > now() - interval '30 days'
 order by u.created_at desc;
