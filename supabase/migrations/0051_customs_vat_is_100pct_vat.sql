-- 0051  Customs VAT (CU-02) is a 100%-VAT line
--
-- The whole CU-02 amount is itself a VAT amount, not a taxable charge. On a
-- quotation it carries no VAT-exclusive value and the full amount lands in the
-- VAT total (grand total unchanged). So when a CU-02 line is pushed from the
-- Import VAT / Duty page it must be written with vat_pct = 100 and no buy cost.
--
-- The app already normalises this on the fly (resolveLine forces CU-02 to
-- vat_pct 100 / buy 0), so this migration only keeps the RPC-written rows in
-- step. Re-saving any existing quote also heals its stored CU-02 line.
--
-- Run in the Supabase SQL editor after 0050. Self-contained & idempotent.

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
  v_buy  numeric;
  v_vat  numeric;
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
  -- DIS-01 service fee and CU-02 (whole amount is VAT) carry no buy cost;
  -- CU-03 Customs Duty stays a pass-through (buy = sell).
  v_buy  := case when p_code in ('DIS-01', 'CU-02') then 0
                 else coalesce(p_amount, 0) end;
  -- CU-02 is 100% VAT, DIS-01 is 15%, everything else 0.
  v_vat  := case p_code when 'CU-02' then 100 when 'DIS-01' then 15 else 0 end;

  update public.quote_lines set
    category = 'Customs Clearance, VAT and Duty Charges',
    description = v_desc,
    cur = 'ZAR',
    unit = v_unit,
    qty = 1,
    fee_rate = v_rate,
    buy = v_buy,
    margin = 0,
    vat_pct = v_vat,
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
       v_desc, 'ZAR', v_unit, 1, v_rate, v_buy, 0, v_vat,
       coalesce(p_amount, 0));
  end if;

  update public.quotes set updated_at = now() where id = p_quote_id;
end;
$$;
