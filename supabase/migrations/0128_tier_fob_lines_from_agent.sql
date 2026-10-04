-- 0128: existing tier sheets' FOB Charges lines (FB-01 Release Fee, FB-02
-- Bill of Lading Fee) take their buy from the linked agent's rate sheet
-- instead of a manual buy — agents price FOB Charges on their FOB sheets
-- since 1ae7150. Any typed manual buy is left in the line (unused).

update public.tariff_sheets t
   set lines = (
     select jsonb_object_agg(
              k,
              case
                when k in ('FB-01', 'FB-02') and coalesce(v ->> 'source', 'manual') = 'manual'
                  then jsonb_set(v, '{source}', '"agent"')
                else v
              end)
       from jsonb_each(t.lines) as e(k, v))
 where exists (
   select 1 from jsonb_each(t.lines) as e(k, v)
    where k in ('FB-01', 'FB-02') and coalesce(v ->> 'source', 'manual') = 'manual');
