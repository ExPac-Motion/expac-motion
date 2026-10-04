-- 0134: Admin Inbox (support@expac.co.za) — Sales CRM › Inbox.
--
--   /api/inbox-sync (Cloudflare Pages Function, every 5 min via pg_cron and
--   on "Sync now") reads the mailbox over IMAP and stores each message here,
--   with the raw .eml in the private "inbox" storage bucket (the app parses
--   it when opened). Replies sent from the app are stored as direction='out'.
--
--   Mail is sorted by RELATIONSHIP, from the CRM — not guessed: the sender
--   matched against customers, suppliers & agents, and leads (exact email
--   first, then company email domain), live in inbox_messages_v, so it
--   re-sorts as the CRM changes. Unmatched = Other / Unknown.
--
--   Messages link to a shipment automatically (its AIR/SEA/RDX/CX/JOB
--   reference, AWB / MBL or container number in the subject, or a reply in
--   a linked thread) or by hand.
--
--   Access: Admin, or a Standard User with the new "inbox" permission (off by
--   default). Needs IMAP_HOST / IMAP_PORT / IMAP_USER / IMAP_PASSWORD on the
--   Cloudflare Pages project; reuses CRON_SECRET + private.follow_up_config.

-- ---------- 1. Messages + sync state ----------
create table if not exists public.inbox_messages (
  id            uuid primary key default gen_random_uuid(),
  mailbox       text not null default 'support',
  uidvalidity   bigint,
  uid           bigint,
  direction     text not null default 'in' check (direction in ('in', 'out')),
  message_id    text,
  in_reply_to   text,
  refs          text,
  thread_key    text,
  from_email    text,
  from_name     text,
  to_emails     text[] not null default '{}',
  cc_emails     text[] not null default '{}',
  subject       text,
  snippet       text,
  body_text     text,
  body_html     text,
  raw_path      text,
  size_bytes    integer,
  has_attachments boolean not null default false,
  is_bulk       boolean not null default false,
  sent_at       timestamptz not null default now(),
  seen          boolean not null default false,
  answered      boolean not null default false,
  read_at       timestamptz,
  replied_at    timestamptz,
  done_at       timestamptz,
  job_id        uuid references public.jobs (id) on delete set null,
  job_linked_by text check (job_linked_by in ('auto', 'manual')),
  sent_by       uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
-- Incoming rows are unique per mailbox / uidvalidity / uid (outgoing rows
-- leave uid empty, and NULLs never clash).
alter table public.inbox_messages drop constraint if exists inbox_messages_imap_uid;
alter table public.inbox_messages
  add constraint inbox_messages_imap_uid unique (mailbox, uidvalidity, uid);
create index if not exists inbox_messages_sent_at on public.inbox_messages (sent_at desc);
create index if not exists inbox_messages_thread on public.inbox_messages (thread_key);
create index if not exists inbox_messages_job on public.inbox_messages (job_id);
create index if not exists inbox_messages_from on public.inbox_messages (lower(from_email));

create table if not exists public.inbox_state (
  mailbox      text primary key,
  uidvalidity  bigint,
  last_sync_at timestamptz,
  last_error   text,
  pending      integer
);

-- ---------- 2. Permission: "inbox" (Standard User, off by default) ----------
create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
  role_key text;
  defaults jsonb := '{
    "user": {
      "ops": true, "shipments": true, "quotes": true, "customs": true, "customers": true,
      "suppliers": true, "leads": true, "inbox": false,
      "rates": false, "settings": true, "crm": true, "delete": false
    },
    "partner": {"delete_sheets": false, "edit_coverage": false, "see_history": false}
  }'::jsonb;
  v text;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found then
    return false;
  end if;
  if me.role = 'admin' then
    return true;
  end if;
  role_key := case
    when me.role = 'user' then 'user'
    when me.role = 'partner' and me.partner_id is not null then 'partner'
  end;
  if role_key is null then
    return false;
  end if;
  v := me.permissions ->> p_key;
  if v is null then
    select role_permissions -> role_key ->> p_key into v from public.company_settings where id = 1;
  end if;
  if v is null then
    v := defaults -> role_key ->> p_key;
  end if;
  return coalesce(v::boolean, false);
end;
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, public.has_perm(k))
  from unnest(array[
    'ops', 'shipments', 'quotes', 'customs', 'customers', 'suppliers', 'leads', 'inbox',
    'rates', 'settings', 'crm', 'delete',
    'delete_sheets', 'edit_coverage', 'see_history'
  ]) as k;
$$;
grant execute on function public.my_permissions() to authenticated;

create or replace function public.can_use_inbox()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and public.has_perm('inbox'));
$$;
grant execute on function public.can_use_inbox() to authenticated;

alter table public.inbox_messages enable row level security;
drop policy if exists "inbox users" on public.inbox_messages;
create policy "inbox users" on public.inbox_messages for all to authenticated
  using (public.can_use_inbox()) with check (public.can_use_inbox());

alter table public.inbox_state enable row level security;
drop policy if exists "inbox users read" on public.inbox_state;
create policy "inbox users read" on public.inbox_state for select to authenticated
  using (public.can_use_inbox());

-- ---------- 3. Who is the sender? (CRM relationship) ----------
-- Free-mail domains never match a company by domain.
create or replace function public.inbox_public_domain(p_domain text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_domain, '')) in (
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'mweb.co.za', 'telkomsa.net', 'webmail.co.za', 'vodamail.co.za', 'iafrica.com', 'qq.com',
    '163.com', '126.com', 'sina.com', 'rediffmail.com', 'gmx.com', 'zoho.com', 'yandex.com',
    'expac.co.za'
  );
$$;

-- category: customer | partner | lead | unknown, plus the matched record.
create or replace function public.inbox_sender_match(p_email text)
returns table (category text, record_kind text, record_id uuid, record_name text)
language plpgsql stable security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  d text := split_part(lower(trim(coalesce(p_email, ''))), '@', 2);
  pass int;
begin
  if e = '' or position('@' in e) = 0 then
    return query select 'unknown'::text, null::text, null::uuid, null::text;
    return;
  end if;
  -- pass 1: exact email; pass 2: same company domain
  for pass in 1..2 loop
    if pass = 2 and (d = '' or public.inbox_public_domain(d)) then
      exit;
    end if;
    -- Customers
    return query
      select 'customer', 'client', c.id, c.company from public.clients c
       where (pass = 1 and lower(c.email) = e) or (pass = 2 and split_part(lower(c.email), '@', 2) = d)
      union all
      select 'customer', 'client', c.id, c.company
        from public.client_contacts cc join public.clients c on c.id = cc.client_id
       where (pass = 1 and lower(cc.email) = e) or (pass = 2 and split_part(lower(cc.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Suppliers & Agents
    return query
      select x.cat, x.kind, x.id, x.company from (
        select 'partner'::text as cat, 'supplier'::text as kind, s.id, s.company, s.email from public.suppliers s
        union all select 'partner', 'agent', a.id, a.company, a.email from public.agents a
        union all select 'partner', 'transporter', t.id, t.company, t.email from public.transporters t
        union all select 'partner', 'clearing_agent', ca.id, ca.company, ca.email from public.clearing_agents ca
        union all select 'partner', 'destination_agent', da.id, da.company, da.email from public.destination_agents da
      ) x
       where (pass = 1 and lower(x.email) = e) or (pass = 2 and split_part(lower(x.email), '@', 2) = d)
      limit 1;
    if found then return; end if;
    -- Leads (not yet customers)
    return query
      select 'lead', 'lead', l.id, l.company from public.leads l
       where l.promoted_client_id is null
         and ((pass = 1 and lower(l.email) = e) or (pass = 2 and split_part(lower(l.email), '@', 2) = d))
      union all
      select 'lead', 'lead', l.id, l.company
        from public.lead_contacts lc join public.leads l on l.id = lc.lead_id
       where l.promoted_client_id is null
         and ((pass = 1 and lower(lc.email) = e) or (pass = 2 and split_part(lower(lc.email), '@', 2) = d))
      limit 1;
    if found then return; end if;
  end loop;
  return query select 'unknown'::text, null::text, null::uuid, null::text;
end;
$$;

drop view if exists public.inbox_messages_v;
create view public.inbox_messages_v with (security_invoker = true) as
  select m.*, s.category, s.record_kind, s.record_id, s.record_name,
         j.reference as job_reference
    from public.inbox_messages m
    left join lateral public.inbox_sender_match(
      case when m.direction = 'out' then m.to_emails[1] else m.from_email end
    ) s on true
    left join public.jobs j on j.id = m.job_id;
grant select on public.inbox_messages_v to authenticated;

-- ---------- 4. Shipment linking ----------
create or replace function public.inbox_find_job(p_text text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  t text := upper(coalesce(p_text, ''));
  refs text[];
  boxes text[];
  awbs text[];
  jid uuid;
begin
  refs := array(select (regexp_matches(t, '\m((?:AIR|SEA|RDX|CX|JOB)\d{6})\M', 'g'))[1]);
  if array_length(refs, 1) > 0 then
    select j.id into jid from public.jobs j where upper(j.reference) = any (refs) limit 1;
    if jid is not null then return jid; end if;
    select j.id into jid from public.jobs j join public.quotes q on q.id = j.quote_id
     where upper(q.reference) = any (refs) limit 1;
    if jid is not null then return jid; end if;
  end if;
  boxes := array(select (regexp_matches(t, '\m([A-Z]{4}\d{7})\M', 'g'))[1]);
  if array_length(boxes, 1) > 0 then
    select j.id into jid from public.jobs j
     where upper(regexp_replace(coalesce(j.container_no, ''), '\s', '', 'g')) = any (boxes) limit 1;
    if jid is not null then return jid; end if;
  end if;
  awbs := array(select regexp_replace((regexp_matches(t, '\m(\d{3}[- ]?\d{8})\M', 'g'))[1], '\D', '', 'g'));
  if array_length(awbs, 1) > 0 then
    select j.id into jid from public.jobs j
     where length(regexp_replace(coalesce(j.awb_mbl, ''), '\D', '', 'g')) = 11
       and regexp_replace(coalesce(j.awb_mbl, ''), '\D', '', 'g') = any (awbs) limit 1;
    if jid is not null then return jid; end if;
  end if;
  return null;
end;
$$;

create or replace function public.inbox_link_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent uuid;
begin
  if new.job_linked_by = 'manual' then
    return new;
  end if;
  if new.job_id is null then
    -- A reply in a thread that's already on a shipment stays on it.
    if new.thread_key is not null then
      select m.job_id into parent from public.inbox_messages m
       where m.thread_key = new.thread_key and m.job_id is not null and m.id <> new.id
       order by m.sent_at desc limit 1;
    end if;
    new.job_id := coalesce(parent, public.inbox_find_job(coalesce(new.subject, '') || ' ' || left(coalesce(new.body_text, ''), 4000)));
    if new.job_id is not null then
      new.job_linked_by := 'auto';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_inbox_link_job on public.inbox_messages;
create trigger trg_inbox_link_job
  before insert or update of subject, body_text on public.inbox_messages
  for each row execute function public.inbox_link_job();

-- ---------- 5. Flags from the mail server (seen / answered elsewhere) ----------
create or replace function public.inbox_apply_flags(p_mailbox text, p_uidvalidity bigint, p_flags jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.inbox_messages m
     set seen = (f.value ->> 0)::boolean,
         answered = (f.value ->> 1)::boolean
    from jsonb_each(p_flags) f
   where m.mailbox = p_mailbox and m.uidvalidity = p_uidvalidity and m.direction = 'in'
     and m.uid = f.key::bigint
     and (m.seen is distinct from (f.value ->> 0)::boolean
          or m.answered is distinct from (f.value ->> 1)::boolean);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.inbox_apply_flags(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.inbox_apply_flags(text, bigint, jsonb) to service_role;

-- ---------- 6. Raw messages: private storage bucket ----------
insert into storage.buckets (id, name, public)
values ('inbox', 'inbox', false)
on conflict (id) do nothing;

drop policy if exists "inbox users read raw" on storage.objects;
create policy "inbox users read raw" on storage.objects for select to authenticated
  using (bucket_id = 'inbox' and public.can_use_inbox());

-- ---------- 7. Sync every 5 minutes ----------
do $$
begin
  perform 1 from pg_extension where extname = 'pg_cron';
  if not found then
    raise notice 'pg_cron not enabled — the inbox syncs only on Sync now / page open';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'inbox-sync') then
    perform cron.unschedule('inbox-sync');
  end if;
  perform cron.schedule(
    'inbox-sync',
    '*/5 * * * *',
    $cron$
      select net.http_post(
        url := c.site_url || '/api/inbox-sync',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', c.cron_secret),
        body := '{}'::jsonb
      )
      from private.follow_up_config c
      where c.site_url is not null and c.cron_secret is not null
      limit 1;
    $cron$
  );
end $$;

notify pgrst, 'reload schema';
