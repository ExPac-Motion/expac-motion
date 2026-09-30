-- GBP (United Kingdom) as a 5th quoting currency — for charge lines, the
-- customer Sell Currency ("Quote & invoice customer totals in a foreign
-- currency") and Commercial Value. Same flat-column pattern as EUR (0074):
-- quotes.fx_gbp_zar + a Settings default, and the three currency checks
-- widened. save_quote is NOT changed — the app writes fx_gbp_zar with a
-- direct update after save_quote (like voyage_no), so no RPC rebuild.
--
-- Run in the Supabase SQL editor after 0112. Self-contained & idempotent.

alter table public.quote_lines drop constraint if exists quote_lines_cur_check;
alter table public.quote_lines add constraint quote_lines_cur_check
  check (cur in ('USD', 'CNY', 'ZAR', 'EUR', 'GBP'));

alter table public.quotes drop constraint if exists quotes_sell_currency_check;
alter table public.quotes add constraint quotes_sell_currency_check
  check (sell_currency is null or sell_currency in ('ZAR', 'USD', 'CNY', 'EUR', 'GBP'));

alter table public.quotes drop constraint if exists quotes_value_currency_check;
alter table public.quotes add constraint quotes_value_currency_check
  check (value_currency in ('ZAR', 'USD', 'CNY', 'EUR', 'GBP'));

alter table public.quotes
  add column if not exists fx_gbp_zar numeric not null default 0;

alter table public.company_settings
  add column if not exists default_fx_gbp_zar numeric not null default 24.00;

notify pgrst, 'reload schema';
