-- ============================================================
-- 0032  Sales CRM: Mailer Templates
-- ============================================================
-- Phase 3 of the Sales CRM brief. Reusable outreach templates — Name and
-- Subject are separate fields (usually the same text, but not always, per
-- the two seeded examples) so a template can have a friendly internal
-- label distinct from what the customer actually sees as the subject
-- line. Body supports simple {{ contact.name }} / {{ contact.company }}
-- merge fields, resolved client-side at send time (not built yet — this
-- migration only covers template management; bulk sending is phase 4,
-- pending the Resend-vs-Xneelo-SMTP decision).
--
-- Run in the Supabase SQL editor after 0031. Self-contained & idempotent.

create table if not exists public.mail_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text not null,
  body       text not null default '',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mail_templates enable row level security;
drop policy if exists "team full access" on public.mail_templates;
create policy "team full access" on public.mail_templates
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.mail_templates (name, subject, body)
select * from (values
  (
    'Cold Outreach Mailer (New Leads Added)',
    'Any Imports or Shipments Requiring Support?',
    E'Good day, {{ contact.name }}\n\nI trust you are doing well.\n\nMy name is Oliver, Support Desk at ExPac Forwarding, We are a leading freight forwarding and logistics company handling air freight, sea freight, courier express, customs clearance and last mile deliveries. I wanted to find out whether you have any current purchase orders requiring landed cost quotations (Freight & Customs), or any live shipments already in transit that may require destination handling, customs clearance, or final delivery assistance.\n\nShould there be anything upcoming, we would be pleased to provide a competitive quotation.'
  ),
  (
    'Wishing You a Great Week Ahead',
    'Wishing You a Great Week Ahead',
    E'Good morning, {{ contact.name }}\n\nI trust you had a wonderful weekend and that your week is off to a great start.\n\nFrom all of us at ExPac Forwarding, we wish you a blessed, successful, and productive week ahead. As always, if there''s anything we can assist with whether it''s an upcoming import, export, customs clearance, or simply a quote request, we''re only a phone call or email away.\n\nThank you for your continued support. We appreciate the opportunity to be part of your logistics journey and look forward to assisting you whenever you need us.\n\nHave a fantastic week ahead,'
  )
) as seed(name, subject, body)
where not exists (select 1 from public.mail_templates where mail_templates.name = seed.name);
