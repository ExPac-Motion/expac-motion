-- 0049  Leads carry a Customer VAT No
--
-- Editable on the lead editor, shown on the lead View card, CSV-importable,
-- flows onto a quotation raised for the lead, and carried across to the
-- customer record when the lead is promoted.
--
-- Run in the Supabase SQL editor after 0048. Self-contained & idempotent.

alter table public.leads
  add column if not exists vat_no text;

-- ---- promote_lead_to_customer also carries vat_no across -------------------
-- (Unchanged from 0046 except vat_no on the clients insert.)
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

  insert into public.clients (company, contact, email, phone, address, vat_no)
  values (lead.company, lead.contact, lead.email, lead.phone, lead.address,
          lead.vat_no)
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
