-- ============================================================
-- 0079  HS Code on Customs Charges invoice lines
-- ============================================================
-- Adds import_vat_duty_lines.hs_code, shown between Product Description
-- and Qty pcs on the Customs Charges page.
--
-- Run in the Supabase SQL editor after 0016. Self-contained & idempotent.

alter table public.import_vat_duty_lines add column if not exists hs_code text not null default '';

create or replace function public.save_import_vat_duty(
  p_quote_id       uuid,
  p_po_no          text,
  p_vat_uplift_pct numeric,
  p_vat_rate_pct   numeric,
  p_lines          jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into public.import_vat_duty
    (quote_id, po_no, vat_uplift_pct, vat_rate_pct)
  values
    (p_quote_id, p_po_no, coalesce(p_vat_uplift_pct, 10),
     coalesce(p_vat_rate_pct, 15))
  on conflict (quote_id) do update set
    po_no          = excluded.po_no,
    vat_uplift_pct = excluded.vat_uplift_pct,
    vat_rate_pct   = excluded.vat_rate_pct,
    updated_at     = now()
  returning id into v_id;

  delete from public.import_vat_duty_lines where ivd_id = v_id;

  insert into public.import_vat_duty_lines
    (ivd_id, position, description, hs_code, qty_pcs, unit_price, cur, roe, duty_rate_pct)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(line ->> 'description', ''),
    coalesce(line ->> 'hs_code', ''),
    coalesce((line ->> 'qty_pcs')::numeric, 0),
    coalesce((line ->> 'unit_price')::numeric, 0),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce((line ->> 'roe')::numeric, 0),
    coalesce((line ->> 'duty_rate_pct')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  return v_id;
end;
$$;
