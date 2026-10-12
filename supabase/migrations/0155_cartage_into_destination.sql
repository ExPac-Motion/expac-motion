-- ============================================================
-- 0155  Cartage & Road Freight folded back into Destination Handling
-- ============================================================
-- The separate 'Cartage and Road Freight Charges' section (0124) is gone:
-- TR-01 / TR-02 and the local warehousing codes (WH-01..03) sit under
-- 'Destination Handling and Delivery Charges' again. Transporters still
-- price the TR / WH codes (app side, codeSource in src/lib/tariff.ts).
--
-- Run in the Supabase SQL editor after 0154. Self-contained & idempotent.

-- Existing quote lines move section.
alter table public.quote_lines drop constraint if exists quote_lines_category_check;
update public.quote_lines
   set category = 'Destination Handling and Delivery Charges'
 where category = 'Cartage and Road Freight Charges';
alter table public.quote_lines add constraint quote_lines_category_check check (category in (
  'International Freight Charges',
  'Ex-Works Charges',
  'FOB Charges',
  'Destination Handling and Delivery Charges',
  'Customs Clearance, VAT and Duty Charges'
));

-- Legacy rate sheet rows.
update public.rate_sheet
   set category = 'Destination Handling and Delivery Charges'
 where category = 'Cartage and Road Freight Charges';

-- Tier sheet lines: a warehousing code placed on Cartage moves to
-- Destination Handling.
update public.tariff_sheets t
   set lines = (
     select jsonb_object_agg(
              k,
              case
                when v ->> 'category' = 'Cartage and Road Freight Charges'
                  then jsonb_set(v, '{category}', '"Destination Handling and Delivery Charges"')
                else v
              end)
       from jsonb_each(t.lines) as e(k, v))
 where exists (
   select 1 from jsonb_each(t.lines) as e(k, v)
    where v ->> 'category' = 'Cartage and Road Freight Charges');

notify pgrst, 'reload schema';
