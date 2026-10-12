-- ============================================================
-- 0158  Portal chat: "General" messages (not about a shipment)
-- ============================================================
-- The portal's Chat with ExPac gains a General option. Those messages
-- belong to the customer, not to a shipment (shipment chat stays in
-- messages / Shipment Comms):
--   * the customer sends with portal_send_general (needs the Messaging
--     portal permission), direction 'in';
--   * ExPac replies from Sales CRM › Customer Messages or the customer
--     record's Messages tab, direction 'out';
--   * read_at marks a customer message as read by ExPac (unread ones show
--     on the notification bell).
--
-- Run in the Supabase SQL editor after 0157. Self-contained & idempotent.

create table if not exists public.client_chat (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  direction     text not null check (direction in ('in', 'out')),
  body          text not null check (length(btrim(body)) > 0),
  sender_name   text,
  sender_email  text,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists client_chat_client_idx on public.client_chat (client_id, created_at desc);
create index if not exists client_chat_unread_idx on public.client_chat (created_at desc)
  where direction = 'in' and read_at is null;

create or replace function public.my_chat_client_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.client_id from public.profiles p
   where p.id = auth.uid() and p.role = 'client'
     and coalesce(p.portal_permissions ->> 'messaging', 'true') <> 'false';
$$;
grant execute on function public.my_chat_client_id() to authenticated;

alter table public.client_chat enable row level security;

-- ExPac staff: read, reply ('out' only) and mark read.
drop policy if exists "staff read" on public.client_chat;
create policy "staff read" on public.client_chat
  for select to authenticated using (public.can_see_accounts());
drop policy if exists "staff reply" on public.client_chat;
create policy "staff reply" on public.client_chat
  for insert to authenticated
  with check (public.can_see_accounts() and direction = 'out');
drop policy if exists "staff mark read" on public.client_chat;
create policy "staff mark read" on public.client_chat
  for update to authenticated
  using (public.can_see_accounts())
  with check (public.can_see_accounts());

-- The customer: its own thread only.
drop policy if exists "customer read own" on public.client_chat;
create policy "customer read own" on public.client_chat
  for select to authenticated using (client_id = public.my_chat_client_id());

create or replace function public.portal_send_general(p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cid uuid := public.my_chat_client_id();
  v_id uuid;
  v_name text;
begin
  if cid is null then
    raise exception 'Only a customer portal login with Messaging access can do this';
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Type a message first';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.client_chat (client_id, direction, body, sender_name, sender_email)
  values (cid, 'in', btrim(p_body), v_name, auth.jwt() ->> 'email')
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.portal_send_general(text) to authenticated;

notify pgrst, 'reload schema';
