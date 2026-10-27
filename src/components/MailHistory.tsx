import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorNote, Loading } from "./common";
import { getMailHistoryBody, listMailHistory, type MailHistoryRow } from "../lib/db";
import { useCan, useClientContacts, useLeadContacts } from "../lib/hooks";
import { formatDateTime, timeAgo } from "../lib/format";

/** Every email to or from these addresses that the Inbox holds (0191),
 *  newest first: what was last said, and by whom. Read-only. */
export default function MailHistory({ emails }: { emails: (string | null | undefined)[] }) {
  const can = useCan();
  const list = [...new Set(emails.map((e) => (e ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  const q = useQuery({
    queryKey: ["mail_history", list],
    queryFn: () => listMailHistory(list),
    enabled: list.length > 0 && can("inbox"),
    retry: false,
  });
  const [open, setOpen] = useState<string | null>(null);

  if (!can("inbox")) return <p className="hint">Mail history needs Inbox access (Settings › Team › permissions).</p>;
  if (list.length === 0) return <EmptyState>No email address on this record yet, so there's no mail to show.</EmptyState>;
  if (q.isLoading) return <Loading />;
  if (q.isError) {
    const msg = q.error instanceof Error ? q.error.message : "";
    if (/mail_history|function/i.test(msg)) return <p className="hint">Mail history needs migration 0191 to be run.</p>;
    return <ErrorNote error={q.error} />;
  }
  const rows = q.data ?? [];
  const last = rows[0];
  const lastIn = rows.find((r) => r.direction === "in");
  const lastOut = rows.find((r) => r.direction === "out");

  return (
    <div className="mail-history">
      <div className="mail-history-sum">
        {last ? (
          <>
            <span>
              <b>Last contact</b> {timeAgo(last.sent_at)}, {last.direction === "in" ? "they wrote to us" : "we wrote to them"}
            </span>
            <span className="muted">
              Last from them: {lastIn ? timeAgo(lastIn.sent_at) : "never"} · Last from ExPac:{" "}
              {lastOut ? timeAgo(lastOut.sent_at) : "never"} · {rows.length}
              {rows.length >= 200 ? "+" : ""} email{rows.length === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          <span className="muted">No mail with {list.join(", ")} in the Inbox yet.</span>
        )}
      </div>
      {rows.map((r) => (
        <MailRow key={r.id} row={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
      ))}
      <p className="hint">Matched on {list.join(", ")}. Includes Quick Mail, Comms and Outlook mail copied to support@.</p>
    </div>
  );
}

/** A customer: its own email and every contact's. */
export function CustomerMailHistory({ clientId, email }: { clientId: string; email: string | null }) {
  const contacts = useClientContacts(clientId);
  if (contacts.isLoading) return <Loading />;
  return <MailHistory emails={[email, ...(contacts.data ?? []).map((c) => c.email)]} />;
}

/** A lead: its own email and every contact's. */
export function LeadMailHistory({ leadId, email }: { leadId: string; email: string | null }) {
  const contacts = useLeadContacts(leadId);
  if (contacts.isLoading) return <Loading />;
  return <MailHistory emails={[email, ...(contacts.data ?? []).map((c) => c.email)]} />;
}

function MailRow({ row, open, onToggle }: { row: MailHistoryRow; open: boolean; onToggle: () => void }) {
  const body = useQuery({
    queryKey: ["mail_history_body", row.id],
    queryFn: () => getMailHistoryBody(row.id),
    enabled: open,
    staleTime: Infinity,
  });
  const out = row.direction === "out";
  const who = out
    ? `To ${[...row.to_emails, ...row.cc_emails].filter((e) => !/support@expac\.co\.za/i.test(e)).join(", ") || "—"}`
    : `From ${row.from_name || row.from_email || "—"}`;
  return (
    <div className={`mail-history-row${open ? " open" : ""}`}>
      <button type="button" className="mail-history-head" onClick={onToggle} aria-expanded={open}>
        <span className={`mail-history-dir ${out ? "out" : "in"}`}>{out ? "Sent" : "Received"}</span>
        <span className="mail-history-main">
          <span className="mail-history-subject">
            {row.subject || "(no subject)"}
            {row.has_attachments && " 📎"}
          </span>
          <span className="muted">
            {who}
            {row.snippet ? ` · ${row.snippet}` : ""}
          </span>
        </span>
        <span className="mail-history-when" title={formatDateTime(row.sent_at)}>
          {formatDateTime(row.sent_at)}
        </span>
      </button>
      {open && (
        <div className="mail-history-body">
          {body.isLoading ? <Loading /> : body.isError ? <ErrorNote error={body.error} /> : body.data || <span className="muted">(no text)</span>}
        </div>
      )}
    </div>
  );
}
