-- 0130: editable tier margins. Platinum / Gold / Silver default margins live
-- in company_settings.tier_margins (were fixed at 10 / 15 / 18 in the app).
-- set_tier_margin() changes a tier's % and puts every trade-route sheet of
-- that tier on it (a sheet's own margin can still be set for a one-off
-- route until the next tier change). Admin only.

alter table public.company_settings
  add column if not exists tier_margins jsonb not null
    default '{"platinum": 10, "gold": 15, "silver": 18}'::jsonb;

create or replace function public.set_tier_margin(p_tier text, p_margin numeric)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change tier margins';
  end if;
  if p_tier not in ('platinum', 'gold', 'silver') then
    raise exception 'Unknown tier %', p_tier;
  end if;
  if p_margin is null or p_margin < 0 or p_margin > 500 then
    raise exception 'Margin must be between 0 and 500%%';
  end if;
  update public.company_settings
     set tier_margins = jsonb_set(coalesce(tier_margins, '{}'::jsonb), array[p_tier], to_jsonb(p_margin)),
         updated_at = now()
   where id = 1;
  update public.tariff_sheets set margin = p_margin, updated_at = now() where tier = p_tier;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.set_tier_margin(text, numeric) from public, anon;
grant execute on function public.set_tier_margin(text, numeric) to authenticated;
