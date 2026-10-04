-- 0135: Inbox › Internal folder. Mail from any expac.co.za address (or a
-- subdomain such as send.expac.co.za) is sorted as Internal, before the
-- customer / supplier / lead match — so a CRM record that carries an ExPac
-- address no longer pulls staff mail into Customers.

-- category: internal | customer | partner | lead | unknown, plus the matched record.
create or replace function public.inbox_sender_match(p_email text)
returns table (category text, record_kind text, record_id uuid, record_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  d text := split_part(lower(trim(coalesce(p_email, ''))), '@', 2);
  pass int;
begin
  if e = '' or position('@' in e) = 0 then
    return query select 'unknown'::text, null::text, null::uuid, null::text;
    return;
  end if;
  -- ExPac's own mail (expac.co.za or a subdomain such as send.expac.co.za)
  -- is Internal — even if a CRM record happens to carry an ExPac address.
  if d = 'expac.co.za' or d like '%.expac.co.za' then
    return query select 'internal'::text, null::text, null::uuid, 'ExPac'::text;
    return;
  end if;
  -- pass 1: exact email; pass 2: same company domain
  for pass in 1..2 loop
    if pass = 2 and (d = '' or public.inbox_public_domain(d)) then
      exit;
    end if;
    -- Customers
    return query
      select 'customer', 'client', c.id, c.company from public.clients c
       where (pass = 1 and lower(c.email) = e) or (pass = 2 and split_part(lower(c.email), '@', 2) = d)
      union all
      select 'customer', 'client', c.id, c.company
        from public.client_contacts cc join public.clients c on c.id = cc.client_id
       where (pass = 1 and lower(cc.email) = e) or (pass = 2 and split_part(lower(cc.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Suppliers & Agents
    return query
      select x.cat, x.kind, x.id, x.company from (
        select 'partner'::text as cat, 'supplier'::text as kind, s.id, s.company, s.email from public.suppliers s
        union all select 'partner', 'agent', a.id, a.company, a.email from public.agents a
        union all select 'partner', 'transporter', t.id, t.company, t.email from public.transporters t
        union all select 'partner', 'clearing_agent', ca.id, ca.company, ca.email from public.clearing_agents ca
        union all select 'partner', 'destination_agent', da.id, da.company, da.email from public.destination_agents da
      ) x
       where (pass = 1 and lower(x.email) = e) or (pass = 2 and split_part(lower(x.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Leads (not yet customers)
    return query
      select 'lead', 'lead', l.id, l.company from public.leads l
       where l.promoted_client_id is null
         and ((pass = 1 and lower(l.email) = e) or (pass = 2 and split_part(lower(l.email), '@', 2) = d))
      union all
      select 'lead', 'lead', l.id, l.company
        from public.lead_contacts lc join public.leads l on l.id = lc.lead_id
       where l.promoted_client_id is null
         and ((pass = 1 and lower(lc.email) = e) or (pass = 2 and split_part(lower(lc.email), '@', 2) = d))
      limit 1;
    if found then return; end if;
  end loop;
  return query select 'unknown'::text, null::text, null::uuid, null::text;
end;
$$;

notify pgrst, 'reload schema';
