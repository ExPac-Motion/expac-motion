-- ============================================================
-- 0217  Motion AI, stage 3: quote drafts and email drafts
-- ============================================================
-- * quotes.ai_draft marks a quotation Motion AI drafted (priced in the app
--   from the tariff sheet on Approve, saved as New Lead). Undo removes it
--   only while it is still an untouched AI draft in New Lead.
-- * The Operations bot gets draft_quote and draft_email. Emails always
--   need a person to press Send (policy locked to draft in 0215).
--
-- Run in the Supabase SQL editor after 0216. Safe to run more than once.

alter table public.quotes add column if not exists ai_draft boolean not null default false;

-- Any later change to the quote (a person saving it in the Quote Builder,
-- sending it, ...) takes it over: it stops being an AI draft, so Undo can
-- never remove someone's work. The first 2 minutes are the draft being
-- created and flagged.
create or replace function public.quotes_clear_ai_draft()
returns trigger language plpgsql as $$
begin
  if old.ai_draft and new.ai_draft and old.created_at < now() - interval '2 minutes' then
    new.ai_draft := false;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quotes_clear_ai_draft on public.quotes;
create trigger trg_quotes_clear_ai_draft before update on public.quotes
  for each row execute function public.quotes_clear_ai_draft();

update public.ai_bots
   set allowed_tools = (
         select array_agg(distinct t order by t)
           from unnest(allowed_tools || array['draft_quote', 'draft_email']) as t
       ),
       system_prompt = replace(
         system_prompt,
         '- Drafting quotations and emails arrives in the next stage; for now describe what you would draft.',
         '- Quotations: use draft_quote. You need the customer (or lead), mode, origin and destination; ask for the packing list (cartons, size in cm, weight per carton) if it is missing, because rates go by chargeable weight. You may check lookup_rates to talk about the lane, but never present prices as final; the saved draft is reviewed by a person.
- Emails: use draft_email for any message to a customer, lead, vendor or partner. Write it in ExPac''s tone: warm, short, professional, plain English, dd/mm/yyyy dates, shipment numbers included. No signature (it is added). An email is never sent by you: a person reviews it and presses Approve & send.'
       ),
       updated_at = now()
 where key = 'ops';
