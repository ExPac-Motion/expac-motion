-- ============================================================
-- 0170  Portal preview: admin access off too (follow-up to 0169)
-- ============================================================
-- 0169 switched off is_staff / has_perm / can_see_accounts during an admin's
-- portal preview, but the warehouse tables use can_use_wms() =
-- is_admin() OR ..., and is_admin() was still true, so the preview still
-- showed every customer's warehouse receipts. is_admin() is now false
-- while previewing as well (so can_use_wms() and every admin-only rule are
-- off), and starting / stopping a preview checks the admin role directly,
-- so the admin can always exit.
--
-- Run in the Supabase SQL editor after 0169. Self-contained & idempotent.

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.in_portal_preview() then false
    else coalesce(
      (select role = 'admin' from public.profiles where id = auth.uid()),
      false
    )
  end;
$$;

create or replace function public.set_portal_preview(p_client uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_company text;
begin
  -- The role itself, not is_admin(): that is false while a preview runs.
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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
