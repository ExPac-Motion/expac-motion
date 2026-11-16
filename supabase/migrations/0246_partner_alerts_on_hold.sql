-- =====================================================================
-- 0246 Partner email alerts ON HOLD.
-- No automatic emails to agents, transporters, destination agents or
-- clearing agents until the Automations / triggers & alerts build
-- (mail format, wording, documents, and who gets what on which trigger,
-- status change or automation).
--
-- What this does:
--   * Pauses the 5-minute "partner-alerts" send job.
--   * Disables the three triggers that queue alerts, so nothing piles up
--     to go out in one burst when alerts are switched back on.
--   * Cancels anything already queued (marked sent, never mailed).
--
-- To resume later (in one go):
--   alter table public.jobs   enable trigger trg_partner_alert_job_insert;
--   alter table public.jobs   enable trigger trg_partner_alert_job_dates;
--   alter table public.quotes enable trigger trg_partner_alert_quote_partner;
--   select cron.alter_job(jobid, active := true) from cron.job where jobname = 'partner-alerts';
--
-- Not affected: emails staff send by hand (RFQs, Partners tab replies,
-- customs handover / clearing instructions, portal login invites).
-- =====================================================================
begin;

alter table public.jobs   disable trigger trg_partner_alert_job_insert;
alter table public.jobs   disable trigger trg_partner_alert_job_dates;
alter table public.quotes disable trigger trg_partner_alert_quote_partner;

select cron.alter_job(jobid, active := false) from cron.job where jobname = 'partner-alerts';

update public.partner_alerts set sent_at = now() where sent_at is null;

commit;
