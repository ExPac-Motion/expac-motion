-- 0048  add_customs_line_to_quote(): support the DIS-01 Disbursement Fee
--
-- The Import VAT / Duty worksheet now also pushes a DIS-01 line (default 2.5%
-- of Customs VAT + Duty). A trailing p_fee_rate is stored on the line so the
-- Quote Builder keeps re-rating DIS-01 against the CU-02 + CU-03 lines on the
-- quote. Non-DIS codes ignore p_fee_rate.
--
-- Run in the Supabase SQL editor after 0047. Self-contained & idempotent.

create or replace function public.add_customs_line_to_quote(
  p_quote_id uuid,
  p_code     text,
  p_amount   numeric,
  p_fee_rate numeric default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_desc text;
  v_unit text;
  v_rate numeric;
  v_pos  int;
begin
  v_desc := case p_code
    when 'CU-02'  then 'Customs VAT'
    when 'CU-03'  then 'Customs Duty'
    when 'DIS-01' then 'Disbursement Fee'
    else p_code
  end;
  v_unit := case p_code when 'DIS-01' then 'DIS' else 'INV' end;
  v_rate := case when p_code = 'DIS-01' then p_fee_rate else null end;

  update public.quote_lines set
    category = 'Customs Clearance, VAT and Duty Charges',
    description = v_desc,
    cur = 'ZAR',
    unit = v_unit,
    qty = 1,
    fee_rate = v_rate,
    buy = coalesce(p_amount, 0),
    margin = 0,
    vat_pct = 0,
    sell = coalesce(p_amount, 0)
  where quote_id = p_quote_id and code = p_code;

  if not found then
    select coalesce(max(position) + 1, 0) into v_pos
      from public.quote_lines where quote_id = p_quote_id;
    insert into public.quote_lines
      (quote_id, position, category, code, description, cur, unit,
       qty, fee_rate, buy, margin, vat_pct, sell)
    values
      (p_quote_id, v_pos, 'Customs Clearance, VAT and Duty Charges', p_code,
       v_desc, 'ZAR', v_unit, 1, v_rate, coalesce(p_amount, 0), 0, 0,
       coalesce(p_amount, 0));
  end if;

  update public.quotes set updated_at = now() where id = p_quote_id;
end;
$$;
