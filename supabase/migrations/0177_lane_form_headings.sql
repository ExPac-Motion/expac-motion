-- ============================================================
-- 0177  Lane quote request headings: "Quote Request CN-ZA" etc.
-- ============================================================
-- The lane forms sit inside the expac.co.za trade-lane pages under the
-- page's own "Tell us what needs to move." heading, so the form's heading
-- is a short lane code and the subtitle says what to do. Only the shown
-- heading / subtitle change; names, links and submissions stay.
--
-- Run in the Supabase SQL editor after 0176. Self-contained & idempotent.

update public.web_forms f
set heading  = 'Quote Request ' || v.code,
    subtitle = 'Fill in what you know, our team will confirm the rest.',
    updated_at = now()
from (values
  ('China-South Africa Route',          'CN-ZA'),
  ('Europe-South Africa Route',         'EU-ZA'),
  ('India-South Africa Route',          'IN-ZA'),
  ('United Kingdom-South Africa Route', 'UK-ZA'),
  ('United States-South Africa Route',  'US-ZA')
) as v(name, code)
where f.name = v.name;
