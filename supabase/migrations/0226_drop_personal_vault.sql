-- ============================================================
-- 0226  Remove the Personal Vault (Control Tower)
-- ============================================================
-- The Personal Vault (0059, 0061, 0084-0086, 0097, 0098) moved out of
-- Motion into its own app on connell.co.za, so Motion only carries
-- business finances (through Sage). Its screens, tab and code are already
-- gone from the app; this drops its three tables.
--
-- SAFETY: this refuses to run if any of the tables still has rows, so
-- nothing is deleted by accident. To see what is there first:
--
--   select 'vault_budget_entries' as t, count(*) from public.vault_budget_entries
--   union all select 'vault_todos', count(*) from public.vault_todos
--   union all select 'vault_notes', count(*) from public.vault_notes;
--
-- Run in the Supabase SQL editor AFTER the app without the vault is
-- deployed. Safe to re-run (does nothing once the tables are gone).

do $$
declare
  n bigint := 0;
  c bigint;
  t text;
begin
  foreach t in array array['vault_budget_entries', 'vault_todos', 'vault_notes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into c;
      if c > 0 then
        raise notice '% has % row(s)', t, c;
        n := n + c;
      end if;
    end if;
  end loop;
  if n > 0 then
    raise exception
      'Personal Vault tables still hold % row(s): not dropping. Export or move them first.', n;
  end if;
end $$;

-- vault_todos references vault_budget_entries, so it goes first.
drop table if exists public.vault_todos;
drop table if exists public.vault_notes;
drop table if exists public.vault_budget_entries;
