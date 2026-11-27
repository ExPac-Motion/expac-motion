-- =====================================================================
-- 0254 Partner Portal: partners only see the shipping documents
-- =====================================================================
-- Until now a partner could open every document ExPac uploaded to their
-- shipment (all but customer invoices). From now on a partner sees only:
--   * the documents they uploaded themselves;
--   * ExPac's uploads of the shipping documents a partner needs:
--       Commercial Invoice, Packing List, MAWB, HAWB, MBL, HBL,
--       Bill of Lading / AWB, Manifest, Cargo Photos / Photos
--     -- never the POD, customs documents, duty / VAT, customer invoices
--     or anything else;
--   * clearing agents: their own Broker Desk files (from_broker).
-- Staff can override one document either way with "Share with partner"
-- (shipment_documents.visible_to_partner: null = follow the type rule,
-- true = share, false = hide). Customer invoices are never shared.
--
-- partner_can_open() drives both the storage policy and the documents
-- list in partner_shipment(), so both follow the new rule.
--
-- Run in the Supabase SQL editor after 0253. Self-contained & idempotent.
-- =====================================================================

alter table public.shipment_documents add column if not exists visible_to_partner boolean;

-- The document types partners see by default.
create or replace function public.partner_doc_type_shared(p_type text)
returns boolean language sql immutable as $$
  select coalesce(p_type, '') in (
    'Commercial Invoice', 'Packing List', 'MAWB', 'HAWB', 'MBL', 'HBL',
    'Bill of Lading / AWB', 'Manifest', 'Cargo Photos', 'Photos');
$$;

create or replace function public.partner_can_open(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_partner_id() is not null and exists (
    select 1
      from public.shipment_documents sd
      join public.jobs j on j.id in (select public.partner_job_ids())
     where sd.storage_path = p_path
       and (sd.job_id = j.id or sd.job_id = j.master_job_id)
       -- invoices to the customer stay with ExPac
       and coalesce(sd.doc_type, '') <> 'Invoice'
       and (sd.from_partner_id = public.my_partner_id()
            or (sd.from_partner_id is null
                and coalesce(sd.visible_to_partner, public.partner_doc_type_shared(sd.doc_type)))
            or (sd.from_broker and public.my_partner_kind() = 'clearing_agent')));
$$;
revoke execute on function public.partner_can_open(text) from public, anon;
grant execute on function public.partner_can_open(text) to authenticated;

notify pgrst, 'reload schema';
