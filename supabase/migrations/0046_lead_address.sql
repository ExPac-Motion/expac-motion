-- 0046  Leads carry a physical / delivery address
--
-- The lead editor now has an Address field, it shows on the lead View
-- card, flows onto a quotation raised for the lead, and is carried across
-- to the customer record when the lead is promoted.
--
-- Run in the Supabase SQL editor after 0045. Self-contained & idempotent.

alter table public.leads
  add column if not exists address text;

-- ---- promote_lead_to_customer now carries the address across ---------------
-- (Unchanged from 0028 except the clients insert includes address.)
create or replace function public.promote_lead_to_customer(p_lead_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_client_id uuid;
  lead public.leads%rowtype;
begin
  select * into lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  if lead.promoted_client_id is not null then
    return lead.promoted_client_id;
  end if;

  insert into public.clients (company, contact, email, phone, address)
  values (lead.company, lead.contact, lead.email, lead.phone, lead.address)
  returning id into v_client_id;

  update public.leads
     set promoted_client_id = v_client_id, promoted_at = now(), updated_at = now()
   where id = p_lead_id;

  update public.quotes
     set client_id = v_client_id
   where lead_id = p_lead_id and client_id is null;

  return v_client_id;
end;
$$;
