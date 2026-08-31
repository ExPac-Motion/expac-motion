-- EXPAC Rate Desk — packing list items per quote. Run in the Supabase SQL editor after 0003.

-- ============================================================
-- Packing list items (L/W/H in cm, weight in kg, qty in cartons)
-- ============================================================
create table if not exists public.packing_list_items (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.quotes (id) on delete cascade,
  position   int  not null default 0,
  length_cm  numeric not null default 0,
  width_cm   numeric not null default 0,
  height_cm  numeric not null default 0,
  actual_kg  numeric not null default 0,
  qty_ctns   numeric not null default 0
);
create index if not exists packing_list_items_quote_id_idx
  on public.packing_list_items (quote_id);

alter table public.packing_list_items enable row level security;
drop policy if exists "team full access" on public.packing_list_items;
create policy "team full access" on public.packing_list_items
  for all to authenticated using (true) with check (true);

-- ============================================================
-- Widen save_quote with p_packing (new arg -> drop old signature first)
-- ============================================================
drop function if exists public.save_quote(
  uuid, text, uuid, uuid, text, text, text, text, text, date, text,
  numeric, numeric, jsonb
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
  p_lines          jsonb,
  p_packing        jsonb
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

  delete from public.packing_list_items where quote_id = v_id;

  insert into public.packing_list_items
    (quote_id, position, length_cm, width_cm, height_cm, actual_kg, qty_ctns)
  select
    v_id,
    coalesce((pk ->> 'position')::int, (ord - 1)::int),
    coalesce((pk ->> 'length_cm')::numeric, 0),
    coalesce((pk ->> 'width_cm')::numeric, 0),
    coalesce((pk ->> 'height_cm')::numeric, 0),
    coalesce((pk ->> 'actual_kg')::numeric, 0),
    coalesce((pk ->> 'qty_ctns')::numeric, 0)
  from jsonb_array_elements(coalesce(p_packing, '[]'::jsonb)) with ordinality as t(pk, ord);

  return v_id;
end;
$$;
