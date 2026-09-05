-- ============================================================
-- 0027  Document the reviewed Security Definer View warnings
-- ============================================================
-- Supabase's Security Advisor flags client_quotes, client_quote_lines,
-- client_jobs, client_messages and client_documents as "Security Definer
-- View" — expected and reviewed. These views intentionally run with the
-- view owner's privileges (not the caller's) so they can read the full
-- quotes/jobs/messages/shipment_documents tables internally and redact
-- specific columns (buy cost, margin, internal agent/transporter ids)
-- before returning rows — something row-level security alone cannot do,
-- since RLS only ever restricts which rows are visible, not which columns.
--
-- Row-level safety comes from each view's WHERE clause filtering by
-- public.my_client_id(), which reads auth.uid() from the CALLING session
-- (unaffected by the view's elevated privileges) — so a customer only
-- ever sees their own rows, and staff (client_id is null) see none via
-- these views at all. Re-verified 2026-09-05 before this migration.
--
-- Run in the Supabase SQL editor after 0026.

comment on view public.client_quotes is $$
Security barrier view for the Customer Portal, reviewed 2026-09-05. Runs
with elevated privileges to redact agent/transporter/clearing-agent and FX
columns; row access is enforced by filtering on my_client_id(), which is
scoped to the calling session regardless of view privileges.
$$;

comment on view public.client_quote_lines is $$
Security barrier view for the Customer Portal, reviewed 2026-09-05. Runs
with elevated privileges to redact buy cost and margin (only sell is
exposed); row access is enforced via a join back to quotes filtered on
my_client_id().
$$;

comment on view public.client_jobs is $$
Security barrier view for the Customer Portal, reviewed 2026-09-05. Runs
with elevated privileges to redact internal notes/PO fields; row access is
enforced by filtering on my_client_id().
$$;

comment on view public.client_messages is $$
Security barrier view for the Customer Portal, reviewed 2026-09-05. Runs
with elevated privileges to exclude internal private notes (kind = note);
row access is enforced via a join back to jobs filtered on my_client_id().
$$;

comment on view public.client_documents is $$
Security barrier view for the Customer Portal, reviewed 2026-09-05. Runs
with elevated privileges; row access requires both a job owned by
my_client_id() and staff having explicitly set visible_to_client = true.
$$;
