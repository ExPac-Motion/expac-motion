-- ============================================================
-- 0167  Admin "View portal as customer" (read-only preview)
-- ============================================================
-- An Admin can open the Customer Portal exactly as one customer sees it,
-- without that customer's password and without changing their login:
--   * set_portal_preview(client) (Admin only) stores which customer the
--     admin is previewing, for 2 hours (null = stop);
--   * my_client_id() and the portal's other "which customer am I" helpers
--     return that customer for the admin, but ONLY on reads (PostgREST GET).
--     Every write (accept a quote, send a message, upload, edit a shipper,
--     tasks, warehouse requests ...) runs as POST / PATCH / DELETE, finds no
--     customer and is refused, so the preview is read-only in the database
--     itself, not just in the app.
-- Customer logins are unaffected (their own client_id comes first).
--
-- Run in the Supabase SQL editor after 0166. Self-contained & idempotent.

alter table public.profiles
  add column if not exists preview_client_id uuid references public.clients (id) on delete set null,
  add column if not exists preview_until timestamptz;

-- The customer an Admin is previewing right now (null if none / expired).
create or replace function public.portal_preview_client()
returns uuid language sql stable security definer set search_path = public as $$
  select p.preview_client_id from public.profiles p
   where p.id = auth.uid() and p.role = 'admin'
     and p.preview_client_id is not null and p.preview_until > now();
$$;
grant execute on function public.portal_preview_client() to authenticated;

-- True on a read request (PostgREST GET); writes never get the preview.
create or replace function public.is_read_request()
returns boolean language sql stable as $$
  select coalesce(current_setting('request.method', true), '') = 'GET';
$$;

create or replace function public.my_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select client_id from public.profiles where id = auth.uid() and role = 'client'),
    case when public.is_read_request() then public.portal_preview_client() end
  );
$$;

create or replace function public.my_invoices_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.client_id from public.profiles p
      where p.id = auth.uid() and p.role = 'client'
        and coalesce(p.portal_permissions ->> 'invoices', 'true') <> 'false'),
    case when public.is_read_request() then public.portal_preview_client() end
  );
$$;

create or replace function public.my_chat_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.client_id from public.profiles p
      where p.id = auth.uid() and p.role = 'client'
        and coalesce(p.portal_permissions ->> 'messaging', 'true') <> 'false'),
    case when public.is_read_request() then public.portal_preview_client() end
  );
$$;

create or replace function public.my_party_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.client_id from public.profiles p
      where p.id = auth.uid() and p.role = 'client'
        and coalesce(p.portal_permissions ->> 'suppliers', 'true') <> 'false'),
    case when public.is_read_request() then public.portal_preview_client() end
  );
$$;

-- Start (p_client) or stop (null) previewing a customer. Admin only.
create or replace function public.set_portal_preview(p_client uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company text;
begin
  if not public.is_admin() then
    raise exception 'Only an ExPac admin can preview the portal';
  end if;
  if p_client is not null then
    select company into v_company from public.clients where id = p_client;
    if v_company is null then
      raise exception 'Customer not found';
    end if;
  end if;
  perform set_config('expac.trusted_profile_update', 'on', true);
  update public.profiles
     set preview_client_id = p_client,
         preview_until = case when p_client is null then null else now() + interval '2 hours' end
   where id = auth.uid();
  perform set_config('expac.trusted_profile_update', 'off', true);
  return v_company;
end;
$$;
grant execute on function public.set_portal_preview(uuid) to authenticated;

notify pgrst, 'reload schema';
