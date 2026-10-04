-- 0126: partner portal logins see only the modes their partner handles.
-- my_partner() also returns the partner's coverage modes (agents /
-- transporters / clearing agents, migration 0114), so the portal's rate
-- sheets offer only those modes. Read via to_jsonb so a partner table
-- without a modes column simply returns none (= every mode).

create or replace function public.partner_modes(p_kind text, p_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(j -> 'modes')), '{}')
  from (
    select case p_kind
      when 'agent' then (select to_jsonb(a) from public.agents a where a.id = p_id)
      when 'transporter' then (select to_jsonb(t) from public.transporters t where t.id = p_id)
      when 'clearing_agent' then (select to_jsonb(c) from public.clearing_agents c where c.id = p_id)
      when 'destination_agent' then (select to_jsonb(d) from public.destination_agents d where d.id = p_id)
    end as j
  ) x
  where jsonb_typeof(j -> 'modes') = 'array';
$$;
revoke execute on function public.partner_modes(text, uuid) from public, anon, authenticated;

-- The return type changes, so drop and recreate.
drop function if exists public.my_partner();
create function public.my_partner()
returns table (partner_kind text, partner_id uuid, company text, modes text[])
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.my_partner_kind();
  p uuid := public.my_partner_id();
begin
  if k is null or p is null then
    return;
  end if;
  return query select k, p, public.partner_company(k, p), coalesce(public.partner_modes(k, p), '{}');
end;
$$;
grant execute on function public.my_partner() to authenticated;
