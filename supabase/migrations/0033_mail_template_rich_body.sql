-- ============================================================
-- 0033  Sales CRM: Mailer Templates — rich HTML body + attachments
-- ============================================================
-- Template bodies now store HTML (built with a formatting toolbar --
-- bold/italic/lists, links, inline images, an unsubscribe-link merge
-- field, and a code view) instead of plain text with \n breaks. This
-- converts the two existing seeded templates in place, adds an
-- `attachments` column for files sent alongside a template, and adds a
-- storage bucket for images/attachments used in template bodies. That
-- bucket must be PUBLIC -- external email recipients' inboxes fetch
-- inline images directly by URL, with no Supabase auth of their own.
--
-- Run in the Supabase SQL editor after 0032. Self-contained & idempotent.

update public.mail_templates
set body = '<p>Good day, {{ contact.name }}</p><p>I trust you are doing well.</p><p>My name is Oliver, Support Desk at ExPac Forwarding, We are a leading freight forwarding and logistics company handling air freight, sea freight, courier express, customs clearance and last mile deliveries. I wanted to find out whether you have any current purchase orders requiring landed cost quotations (Freight &amp; Customs), or any live shipments already in transit that may require destination handling, customs clearance, or final delivery assistance.</p><p>Should there be anything upcoming, we would be pleased to provide a competitive quotation.</p>'
where name = 'Cold Outreach Mailer (New Leads Added)'
  and body not like '<%';

update public.mail_templates
set body = '<p>Good morning, {{ contact.name }}</p><p>I trust you had a wonderful weekend and that your week is off to a great start.</p><p>From all of us at ExPac Forwarding, we wish you a blessed, successful, and productive week ahead. As always, if there''s anything we can assist with whether it''s an upcoming import, export, customs clearance, or simply a quote request, we''re only a phone call or email away.</p><p>Thank you for your continued support. We appreciate the opportunity to be part of your logistics journey and look forward to assisting you whenever you need us.</p><p>Have a fantastic week ahead,</p>'
where name = 'Wishing You a Great Week Ahead'
  and body not like '<%';

alter table public.mail_templates
  add column if not exists attachments jsonb not null default '[]';

insert into storage.buckets (id, name, public)
values ('mail-assets', 'mail-assets', true)
on conflict (id) do nothing;

drop policy if exists "mail-assets staff write" on storage.objects;
create policy "mail-assets staff write" on storage.objects
  for all to authenticated
  using (bucket_id = 'mail-assets' and public.is_staff())
  with check (bucket_id = 'mail-assets' and public.is_staff());

drop policy if exists "mail-assets public read" on storage.objects;
create policy "mail-assets public read" on storage.objects
  for select to public
  using (bucket_id = 'mail-assets');
