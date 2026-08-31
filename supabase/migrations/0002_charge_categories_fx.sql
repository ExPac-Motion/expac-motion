-- EXPAC Rate Desk — charge categories, per-line code/currency/unit, quote FX rates.
-- Run this in the Supabase SQL editor after 0001_init.sql.

-- ============================================================
-- Quotes: FX rates used to convert buy cost to ZAR for margin
-- ============================================================
alter table public.quotes
  add column if not exists fx_usd_zar numeric not null default 18.50,
  add column if not exists fx_cny_zar numeric not null default 2.60;

-- ============================================================
-- Quote lines: category grouping + code / currency / unit
-- ============================================================
alter table public.quote_lines
  add column if not exists category text not null default 'International Freight Charges',
  add column if not exists code     text not null default '',
  add column if not exists cur      text not null default 'USD',
  add column if not exists unit     text not null default '';

alter table public.quote_lines
  drop constraint if exists quote_lines_category_check,
  drop constraint if exists quote_lines_cur_check;

alter table public.quote_lines
  add constraint quote_lines_category_check check (category in (
    'International Freight Charges',
    'Ex-Works Charges',
    'Destination Handling and Delivery Charges',
    'Customs Clearance, VAT and Duty Charges'
  )),
  add constraint quote_lines_cur_check check (cur in ('USD', 'CNY', 'ZAR'));

-- ============================================================
-- Replace save_quote with the wider signature (2 new params,
-- 4 new per-line fields). Old signature must be dropped first.
-- ============================================================
drop function if exists public.save_quote(
  uuid, text, uuid, uuid, text, text, text, text, text, date, text, jsonb
);

create or replace function public.save_quote(
  p_id             uuid,
  p_reference      text,
  p_client_id      uuid,
  p_supplier_id    uuid,
  p_mode           text,
  p_commodity      text,
  p_origin         text,
  p_destination    text,
  p_delivery_terms text,
  p_valid_until    date,
  p_status         text,
  p_fx_usd_zar     numeric,
  p_fx_cny_zar     numeric,
  p_lines          jsonb
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.quotes
      (reference, client_id, supplier_id, mode, commodity, origin,
       destination, delivery_terms, valid_until, status, fx_usd_zar, fx_cny_zar)
    values
      (p_reference, p_client_id, p_supplier_id, p_mode, p_commodity, p_origin,
       p_destination, p_delivery_terms, p_valid_until, p_status,
       coalesce(p_fx_usd_zar, 0), coalesce(p_fx_cny_zar, 0))
    returning id into v_id;
  else
    update public.quotes set
      reference      = p_reference,
      client_id      = p_client_id,
      supplier_id    = p_supplier_id,
      mode           = p_mode,
      commodity      = p_commodity,
      origin         = p_origin,
      destination    = p_destination,
      delivery_terms = p_delivery_terms,
      valid_until    = p_valid_until,
      status         = p_status,
      fx_usd_zar     = coalesce(p_fx_usd_zar, 0),
      fx_cny_zar     = coalesce(p_fx_cny_zar, 0),
      updated_at     = now()
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'Quote % not found', p_id;
    end if;
  end if;

  delete from public.quote_lines where quote_id = v_id;

  insert into public.quote_lines
    (quote_id, position, category, code, description, cur, unit, qty, buy, sell)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(nullif(line ->> 'category', ''), 'International Freight Charges'),
    coalesce(line ->> 'code', ''),
    coalesce(line ->> 'description', ''),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce(line ->> 'unit', ''),
    coalesce((line ->> 'qty')::numeric, 0),
    coalesce((line ->> 'buy')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  return v_id;
end;
$$;
