-- 0203: Live Inbox. Inbox mail, drafts and the sync state join the
-- supabase_realtime publication, so a change in one tab (read/unread, filed
-- to a shipment, archived, new mail from the server sync) shows in every
-- open tab at once instead of on the next 30-60s poll. Same pattern as 0198;
-- RLS still decides who receives each change. Safe to run more than once.

do $$
declare
  t text;
begin
  foreach t in array array['inbox_messages', 'inbox_drafts', 'inbox_state']
  loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
       ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
