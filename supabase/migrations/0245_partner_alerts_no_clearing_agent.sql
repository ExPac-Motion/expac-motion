-- =====================================================================
-- 0245 Partner email alerts: agents only, never the clearing agent.
-- 0244 also queued "assigned" and date-change alerts for the clearing
-- agent (from the customs file or the quote). The clearing agent works
-- through the Broker Desk and must not get these emails.
-- =====================================================================
begin;

-- The partners on a job, for alerts: agent, transporter, destination agent.
create or replace function public.job_partner_list(p_job uuid)
returns table (partner_kind text, partner_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs%rowtype;
  q public.quotes%rowtype;
begin
  select * into j from public.jobs where id = p_job;
  if not found then
    return;
  end if;
  select * into q from public.quotes
   where id = coalesce(j.quote_id, (select m.quote_id from public.jobs m where m.id = j.master_job_id));
  if q.agent_id is not null then
    partner_kind := 'agent'; partner_id := q.agent_id; return next;
  end if;
  if q.transporter_id is not null then
    partner_kind := 'transporter'; partner_id := q.transporter_id; return next;
  end if;
  if q.destination_agent_id is not null then
    partner_kind := 'destination_agent'; partner_id := q.destination_agent_id; return next;
  end if;
end;
$$;
revoke execute on function public.job_partner_list(uuid) from public, anon, authenticated;

-- A partner added to a quote that already has its shipment (no clearing agent).
create or replace function public.partner_alert_on_quote_partner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jid uuid;
begin
  for jid in select id from public.jobs where quote_id = new.id and ops_completed_at is null loop
    if new.agent_id is not null and new.agent_id is distinct from old.agent_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('agent', new.agent_id, jid, 'assigned');
    end if;
    if new.transporter_id is not null and new.transporter_id is distinct from old.transporter_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('transporter', new.transporter_id, jid, 'assigned');
    end if;
    if new.destination_agent_id is not null and new.destination_agent_id is distinct from old.destination_agent_id then
      insert into public.partner_alerts (partner_kind, partner_id, job_id, kind) values ('destination_agent', new.destination_agent_id, jid, 'assigned');
    end if;
  end loop;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists trg_partner_alert_quote_partner on public.quotes;
create trigger trg_partner_alert_quote_partner
  after update of agent_id, transporter_id, destination_agent_id on public.quotes
  for each row execute function public.partner_alert_on_quote_partner();

-- Anything still queued for a clearing agent is never sent.
update public.partner_alerts set sent_at = now()
 where partner_kind = 'clearing_agent' and sent_at is null;

commit;
notify pgrst, 'reload schema';
