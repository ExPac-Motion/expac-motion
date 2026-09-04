-- ============================================================
-- 0016  Import VAT / Duty Output
-- ============================================================
-- A per-quote worksheet that turns a commercial invoice into the
-- SARS added-tax-value calculation:
--   foreign amount = qty x unit price
--   local amount   = foreign amount x ROE
--   customs markup = local amount x vat_uplift_pct   (statutory 10%)
--   customs value  = local amount + customs markup
--   ttl duty       = customs value x duty_rate_pct   (per line)
--   taxable value  = customs value + ttl duty
--   ttl import VAT = taxable value x vat_rate_pct     (15%)
-- The section totals for import VAT and duty are pushed onto the
-- quote as its CU-02 (Customs VAT) and CU-03 (Customs Duty) charge
-- lines via add_customs_line_to_quote().
--
-- Run in the Supabase SQL editor after 0015. Self-contained & idempotent.

create table if not exists public.import_vat_duty (
  id             uuid primary key default gen_random_uuid(),
  quote_id       uuid not null references public.quotes (id) on delete cascade,
  po_no          text,
  vat_uplift_pct numeric not null default 10,
  vat_rate_pct   numeric not null default 15,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (quote_id)
);

create table if not exists public.import_vat_duty_lines (
  id            uuid primary key default gen_random_uuid(),
  ivd_id        uuid not null references public.import_vat_duty (id) on delete cascade,
  position      int not null default 0,
  description   text not null default '',
  qty_pcs       numeric not null default 0,
  unit_price    numeric not null default 0,
  cur           text not null default 'USD',
  roe           numeric not null default 0,
  duty_rate_pct numeric not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists import_vat_duty_lines_ivd_idx
  on public.import_vat_duty_lines (ivd_id);

do $$
declare
  t text;
begin
  foreach t in array array['import_vat_duty', 'import_vat_duty_lines']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "team full access" on public.%I;', t);
    execute format(
      'create policy "team full access" on public.%I
         for all to authenticated using (true) with check (true);', t);
  end loop;
end;
$$;

-- ---- Upsert the worksheet + replace its lines (one per quote) ----
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
    (ivd_id, position, description, qty_pcs, unit_price, cur, roe, duty_rate_pct)
  select
    v_id,
    coalesce((line ->> 'position')::int, (ord - 1)::int),
    coalesce(line ->> 'description', ''),
    coalesce((line ->> 'qty_pcs')::numeric, 0),
    coalesce((line ->> 'unit_price')::numeric, 0),
    coalesce(nullif(line ->> 'cur', ''), 'USD'),
    coalesce((line ->> 'roe')::numeric, 0),
    coalesce((line ->> 'duty_rate_pct')::numeric, 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(line, ord);

  return v_id;
end;
$$;

-- ---- Create or replace one catalog-coded charge line on a quote ----
-- Used by the "Add VAT / Add Duty to Quote Builder" buttons. The line is
-- a plain ZAR line (margin 0, qty 1) so sell = buy = p_amount.
create or replace function public.add_customs_line_to_quote(
  p_quote_id uuid,
  p_code     text,
  p_amount   numeric
)
returns void
language plpgsql
security invoker
as $$
declare
  v_desc text;
  v_pos  int;
begin
  v_desc := case p_code
    when 'CU-02' then 'Customs VAT'
    when 'CU-03' then 'Customs Duty'
    else p_code
  end;

  update public.quote_lines set
    category = 'Customs Clearance, VAT and Duty Charges',
    description = v_desc,
    cur = 'ZAR',
    unit = 'INV',
    qty = 1,
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
       qty, buy, margin, vat_pct, sell)
    values
      (p_quote_id, v_pos, 'Customs Clearance, VAT and Duty Charges', p_code,
       v_desc, 'ZAR', 'INV', 1, coalesce(p_amount, 0), 0, 0,
       coalesce(p_amount, 0));
  end if;

  update public.quotes set updated_at = now() where id = p_quote_id;
end;
$$;
