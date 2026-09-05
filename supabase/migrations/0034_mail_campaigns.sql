-- ============================================================
-- 0034  Sales CRM Phase 4: Bulk mailer campaigns + unsubscribe
-- ============================================================
-- Send a mail_templates template to a chosen set of leads. Sending is
-- immediate only in this first pass -- "on specific days" (scheduled
-- sends) needs a cron trigger, which Cloudflare Pages Functions don't
-- have on their own (a Worker + Cron Trigger would need to be added
-- separately); deferred, same as the tracking auto-refresh gap.
--
-- Run in the Supabase SQL editor after 0033. Self-contained & idempotent.

alter table public.leads
  add column if not exists unsubscribed_at timestamptz;

create table if not exists public.mail_campaigns (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid references public.mail_templates (id) on delete set null,
  name          text not null,
  subject       text not null,
  body          text not null default '',
  status        text not null default 'draft'
                  check (status in ('draft', 'sending', 'sent', 'failed')),
  recipient_filter jsonb not null default '{}',
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create table if not exists public.mail_campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.mail_campaigns (id) on delete cascade,
  lead_id       uuid references public.leads (id) on delete set null,
  email         text not null,
  status        text not null default 'pending'
                  check (status in
                    ('pending', 'sent', 'failed', 'delivered', 'opened', 'clicked', 'bounced')),
  provider_id   text,
  error         text,
  sent_at       timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mail_campaign_recipients_campaign_idx
  on public.mail_campaign_recipients (campaign_id);
create index if not exists mail_campaign_recipients_provider_idx
  on public.mail_campaign_recipients (provider_id);

alter table public.mail_campaigns enable row level security;
drop policy if exists "team full access" on public.mail_campaigns;
create policy "team full access" on public.mail_campaigns
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.mail_campaign_recipients enable row level security;
drop policy if exists "team full access" on public.mail_campaign_recipients;
create policy "team full access" on public.mail_campaign_recipients
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Called from the public /unsubscribe page -- no session, so it must be
-- reachable by the anon role. security definer so it can update `leads`
-- despite the caller having no row-level access of their own.
create or replace function public.unsubscribe_lead(p_recipient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id uuid;
begin
  select lead_id into v_lead_id
  from public.mail_campaign_recipients
  where id = p_recipient_id;

  if v_lead_id is null then
    return false;
  end if;

  update public.leads set unsubscribed_at = now() where id = v_lead_id;
  return true;
end;
$$;

grant execute on function public.unsubscribe_lead(uuid) to anon, authenticated;
