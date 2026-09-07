-- 0050  add_customs_line_to_quote(): DIS-01 is a service fee — no buy cost
--
-- DIS-01 is now a pure ExPac service fee (revenue, no cost), so the pushed
-- line gets buy = 0 and sell = the amount. CU-02 / CU-03 stay pass-through
-- (buy = sell = amount, no GP). CU-05 was renamed from CU-051 in the app
-- catalog — no DB change needed for that, codes are free text.
--
-- Run in the Supabase SQL editor after 0049. Self-contained & idempotent.

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
  -- DIS-01 is a service fee: no buy cost. VAT/Duty pass through (buy = sell).
  v_buy  := case when p_code = 'DIS-01' then 0 else coalesce(p_amount, 0) end;

  update public.quote_lines set
    category = 'Customs Clearance, VAT and Duty Charges',
    description = v_desc,
    cur = 'ZAR',
    unit = v_unit,
    qty = 1,
    fee_rate = v_rate,
    buy = v_buy,
    margin = 0,
    vat_pct = case when p_code = 'DIS-01' then 15 else 0 end,
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
       v_desc, 'ZAR', v_unit, 1, v_rate, v_buy, 0,
       case when p_code = 'DIS-01' then 15 else 0 end,
       coalesce(p_amount, 0));
  end if;

  update public.quotes set updated_at = now() where id = p_quote_id;
end;
$$;
