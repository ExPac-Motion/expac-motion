-- EXPAC Rate Desk — per-line markup %. Sell = buy x (1 + margin/100) x fx(cur).
-- Run in the Supabase SQL editor after 0002.

alter table public.quote_lines
  add column if not exists margin numeric not null default 0;

-- save_quote keeps the same signature (margin travels inside p_lines),
-- so create-or-replace is enough — only the line insert changes.
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
    (quote_id, position, category, code, description, cur, unit, qty, buy, margin, sell)
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
    coalesce((line ->> 'margin')::numeric, 0),
    coalesce((line ->> 'sell')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  return v_id;
end;
$$;
