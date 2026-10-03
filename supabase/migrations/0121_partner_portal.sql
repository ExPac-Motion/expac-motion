-- ============================================================
-- 0121  Partner portal: agents / transporters / clearing agents log in
--       and keep their own rate sheets up to date
-- ============================================================
-- A partner login (profiles.role = 'partner') is linked to ONE agent,
-- transporter or clearing agent (partner_kind + partner_id) and can only:
--   * read, add and edit THAT partner's partner_rate_sheets (their buy
--     rates to us) — never delete, never another partner's;
--   * read its own company name (my_partner()).
-- It is not staff (is_staff() is an explicit admin/user allow-list), not a
-- customer (my_client_id() requires role='client'), and never sees tier
-- sheets, sell rates, margins, quotes, customers or shipments.
--
-- Logins are created from an admin-issued invite link (partner_invites),
-- claimable once, only by the invite's email address. Every change to a
-- partner rate sheet is recorded in partner_rate_sheet_history (admin-only).
--
-- Also: client_rate_sheet (0071, sell prices for the customer portal) was
-- readable by every authenticated login — now customer logins only (and
-- admin), so a partner can never see our sell rates.
--
-- Run in the Supabase SQL editor after 0120. Self-contained & idempotent.

-- ---------- 1. Role + partner link on profiles ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'user', 'client', 'restricted', 'partner'));

alter table public.profiles
  add column if not exists partner_kind text
    check (partner_kind in ('agent', 'transporter', 'clearing_agent')),
  add column if not exists partner_id uuid;

-- Only an admin can change role / links / portal fields (adds the partner link).
create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.client_id := old.client_id;
    new.portal_status := old.portal_status;
    new.portal_permissions := old.portal_permissions;
    new.partner_kind := old.partner_kind;
    new.partner_id := old.partner_id;
  end if;
  return new;
end;
$$;

-- A partner signup is role='partner' from the first instant the auth user
-- exists (never role='user' / staff, even if the invite is never claimed).
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
    insert into public.profiles (id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- ---------- 2. Who am I (partner) ----------
create or replace function public.my_partner_kind()
returns text language sql stable security definer set search_path = public as $$
  select partner_kind from public.profiles
   where id = auth.uid() and role = 'partner' and partner_id is not null;
$$;
create or replace function public.my_partner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select partner_id from public.profiles
   where id = auth.uid() and role = 'partner' and partner_kind is not null;
$$;

-- The partner's own company name, for the portal header.
create or replace function public.my_partner()
returns table (partner_kind text, partner_id uuid, company text)
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
begin
  if k is null or p is null then
    return;
  end if;
  return query
    select k, p,
      case k
        when 'agent' then (select a.company from public.agents a where a.id = p)
        when 'transporter' then (select t.company from public.transporters t where t.id = p)
        else (select c.company from public.clearing_agents c where c.id = p)
      end;
end;
$$;
grant execute on function public.my_partner() to authenticated;

-- ---------- 3. Partner rate sheets: own rows only ----------
alter table public.partner_rate_sheets
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

drop policy if exists "partner reads own" on public.partner_rate_sheets;
create policy "partner reads own" on public.partner_rate_sheets
  for select to authenticated
  using (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id());
drop policy if exists "partner adds own" on public.partner_rate_sheets;
create policy "partner adds own" on public.partner_rate_sheets
  for insert to authenticated
  with check (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id());
drop policy if exists "partner edits own" on public.partner_rate_sheets;
create policy "partner edits own" on public.partner_rate_sheets
  for update to authenticated
  using (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id())
  with check (partner_kind = public.my_partner_kind() and partner_id = public.my_partner_id());

-- ---------- 4. Change history ----------
create table if not exists public.partner_rate_sheet_history (
  id           uuid primary key default gen_random_uuid(),
  sheet_id     uuid not null,
  partner_kind text not null,
  partner_id   uuid not null,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changed_by   uuid references auth.users (id) on delete set null,
  changed_by_email text,
  changed_at   timestamptz not null default now(),
  old_row      jsonb,
  new_row      jsonb
);
create index if not exists partner_rate_sheet_history_sheet_idx
  on public.partner_rate_sheet_history (sheet_id, changed_at desc);

alter table public.partner_rate_sheet_history enable row level security;
drop policy if exists "admin only" on public.partner_rate_sheet_history;
create policy "admin only" on public.partner_rate_sheet_history
  for select to authenticated using (public.is_admin());

create or replace function public.log_partner_rate_sheet()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.partner_rate_sheets%rowtype;
begin
  if tg_op = 'DELETE' then
    r := old;
  else
    r := new;
  end if;
  insert into public.partner_rate_sheet_history
    (sheet_id, partner_kind, partner_id, action, changed_by, changed_by_email, old_row, new_row)
  values (
    r.id, r.partner_kind, r.partner_id, lower(tg_op), auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end;
$$;
drop trigger if exists trg_partner_rate_sheet_history on public.partner_rate_sheets;
create trigger trg_partner_rate_sheet_history
  after insert or update or delete on public.partner_rate_sheets
  for each row execute function public.log_partner_rate_sheet();

create or replace function public.stamp_partner_rate_sheet()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_partner_rate_sheet_stamp on public.partner_rate_sheets;
create trigger trg_partner_rate_sheet_stamp
  before insert or update on public.partner_rate_sheets
  for each row execute function public.stamp_partner_rate_sheet();

-- ---------- 5. Invites ----------
create table if not exists public.partner_invites (
  token        uuid primary key default gen_random_uuid(),
  partner_kind text not null check (partner_kind in ('agent', 'transporter', 'clearing_agent')),
  partner_id   uuid not null,
  email        text not null,
  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  claimed_by   uuid references auth.users (id) on delete set null,
  claimed_at   timestamptz
);
alter table public.partner_invites enable row level security;
drop policy if exists "admin only" on public.partner_invites;
create policy "admin only" on public.partner_invites
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The signup page checks a token without listing invites (no anon table
-- access at all — a token can only be looked up if you already hold it).
create or replace function public.get_partner_invite(p_token uuid)
returns table (email text, company text, partner_kind text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select i.email,
      case i.partner_kind
        when 'agent' then (select a.company from public.agents a where a.id = i.partner_id)
        when 'transporter' then (select t.company from public.transporters t where t.id = i.partner_id)
        else (select c.company from public.clearing_agents c where c.id = i.partner_id)
      end,
      i.partner_kind
    from public.partner_invites i
    where i.token = p_token and i.claimed_at is null;
end;
$$;
grant execute on function public.get_partner_invite(uuid) to anon, authenticated;

-- Claimable once, only by a fresh partner login with the invite's email.
create or replace function public.claim_partner_invite(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  inv public.partner_invites%rowtype;
  me  public.profiles%rowtype;
begin
  select * into inv from public.partner_invites
   where token = p_token and claimed_at is null;
  if inv.token is null then
    raise exception 'Invalid or already-used invite link';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'partner' or me.partner_id is not null then
    raise exception 'This invite can only be used by a new partner login';
  end if;
  if lower(coalesce(me.email, '')) <> lower(inv.email) then
    raise exception 'This invite was sent to %. Sign up with that email address.', inv.email;
  end if;
  update public.partner_invites set claimed_by = auth.uid(), claimed_at = now()
   where token = p_token;
  update public.profiles
     set partner_kind = inv.partner_kind, partner_id = inv.partner_id
   where id = auth.uid();
end;
$$;
grant execute on function public.claim_partner_invite(uuid) to authenticated;

-- ---------- 6. Admin: list / revoke / restore partner logins ----------
create or replace function public.list_partner_users(p_kind text, p_partner_id uuid)
returns table (id uuid, full_name text, email text, role text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  return query
    select p.id, p.full_name, p.email, p.role, p.created_at, u.last_sign_in_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.partner_kind = p_kind and p.partner_id = p_partner_id
    order by p.created_at;
end;
$$;

create or replace function public.set_partner_access(p_profile_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised';
  end if;
  update public.profiles
     set role = case when p_enabled then 'partner' else 'restricted' end
   where id = p_profile_id and partner_id is not null;
end;
$$;

-- ---------- 7. Customer sell rates: customer logins only ----------
create or replace view public.client_rate_sheet
with (security_barrier = true) as
select
  r.id, r.mode, r.origin, r.destination, r.carrier, r.category,
  r.code, r.description, r.unit, r.cur,
  round(r.buy * (1 + r.margin / 100), 2) as sell
from public.rate_sheet r
where public.my_client_id() is not null or public.is_admin();

notify pgrst, 'reload schema';
