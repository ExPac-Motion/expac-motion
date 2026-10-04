-- 0127: partner rate sheets feed the partner's Coverage.
--   * my_partner() also returns the partner's coverage countries, so the
--     portal's rate sheets offer "<country> → South Africa" trade routes.
--   * Saving a rate sheet adds its origin / destination port or airport
--     codes (UN/LOCODE, e.g. "CNPEK — Beijing, China" -> CNPEK) to the
--     partner's ports, and the trade route's origin country ("China" in
--     "China → South Africa") to its countries — portal logins included.

create or replace function public.partner_countries(p_kind text, p_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(j -> 'countries')), '{}')
  from (
    select case p_kind
      when 'agent' then (select to_jsonb(a) from public.agents a where a.id = p_id)
      when 'transporter' then (select to_jsonb(t) from public.transporters t where t.id = p_id)
      when 'clearing_agent' then (select to_jsonb(c) from public.clearing_agents c where c.id = p_id)
      when 'destination_agent' then (select to_jsonb(d) from public.destination_agents d where d.id = p_id)
    end as j
  ) x
  where jsonb_typeof(j -> 'countries') = 'array';
$$;
revoke execute on function public.partner_countries(text, uuid) from public, anon, authenticated;

drop function if exists public.my_partner();
create function public.my_partner()
returns table (partner_kind text, partner_id uuid, company text, modes text[], countries text[])
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
begin
  if k is null or p is null then
    return;
  end if;
  return query select k, p, public.partner_company(k, p),
    coalesce(public.partner_modes(k, p), '{}'),
    coalesce(public.partner_countries(k, p), '{}');
end;
$$;
grant execute on function public.my_partner() to authenticated;

create or replace function public.partner_sheet_to_coverage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tbl text := case new.partner_kind
    when 'agent' then 'agents'
    when 'transporter' then 'transporters'
    when 'clearing_agent' then 'clearing_agents'
    when 'destination_agent' then 'destination_agents'
  end;
  codes text[];
  country text;
begin
  if tbl is null then
    return new;
  end if;
  select coalesce(array_agg(distinct m[1]), '{}') into codes
  from (
    select regexp_match(coalesce(v, ''), '^\s*([A-Z]{2}[A-Z0-9]{3})(\s|$)') as m
    from unnest(array[new.origin, new.destination]) as v
  ) s
  where m is not null;
  if position('→' in coalesce(new.route, '')) > 0 then
    country := nullif(trim(split_part(new.route, '→', 1)), '');
    if country ilike 'any' then
      country := null;
    end if;
  end if;
  execute format(
    'update public.%I
        set ports = ports || array(select unnest($1::text[]) except select unnest(ports)),
            countries = case when $2::text is null or $2::text = any(countries)
                             then countries else countries || $2::text end
      where id = $3',
    tbl)
  using codes, country, new.partner_id;
  return new;
end;
$$;

drop trigger if exists trg_partner_sheet_to_coverage on public.partner_rate_sheets;
create trigger trg_partner_sheet_to_coverage
  after insert or update of route, origin, destination on public.partner_rate_sheets
  for each row execute function public.partner_sheet_to_coverage();
