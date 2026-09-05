import { useMemo } from "react";
import {
  useJobs,
  useMessagesForJobs,
  useOpsTasks,
  useQuotes,
  useShipmentDocumentsForJobs,
} from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { formatDate, money } from "../lib/format";
import { STATUS_LABEL, STATUS_ORDER } from "../lib/types";

/**
 * A customer's deal pipeline + activity timeline + open tasks — the
 * content that used to live on the Sales CRM "Opportunities" tab before
 * that became a real Kanban pipeline. Relocated onto the Customers page
 * (shown inside a client's View modal) rather than dropped.
 */
export default function ClientActivity({ clientId }: { clientId: string }) {
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const tasksQ = useOpsTasks();

  const quotes = useMemo(
    () => (quotesQ.data ?? []).filter((q) => q.client_id === clientId),
    [quotesQ.data, clientId],
  );
  const jobs = useMemo(
    () => (jobsQ.data ?? []).filter((j) => j.client_id === clientId),
    [jobsQ.data, clientId],
  );
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const messagesQ = useMessagesForJobs(jobIds);
  const docsQ = useShipmentDocumentsForJobs(jobIds);
  const tasks = (tasksQ.data ?? []).filter((t) => t.client_id === clientId);

  const pipeline = STATUS_ORDER.map((st) => {
    const rows = quotes.filter((q) => q.status === st);
    const value = rows.reduce(
      (sum, q) => sum + chargeTotals(q.quote_lines, fxOf(q)).sell,
      0,
    );
    return { st, count: rows.length, value };
  });

  type Event = { date: string; label: string; detail?: string };
  const events: Event[] = [
    ...quotes.map((q) => ({
      date: q.created_at,
      label: `Quote ${q.reference} created`,
      detail: STATUS_LABEL[q.status],
    })),
    ...jobs.flatMap((j) =>
      (j.job_events ?? []).map((e) => ({
        date: e.created_at,
        label: `${j.reference}: milestone → ${e.milestone}`,
        detail: e.note ?? undefined,
      })),
    ),
    ...(messagesQ.data ?? [])
      .filter((m) => m.kind === "email")
      .map((m) => ({
        date: m.created_at,
        label: `Email sent: ${m.subject ?? "(no subject)"}`,
        detail: m.status,
      })),
    ...(docsQ.data ?? []).map((d) => ({
      date: d.created_at,
      label: `Document ${d.kind === "generated" ? "generated" : "uploaded"}: ${d.name}`,
    })),
    ...tasks
      .filter((t) => t.status === "done" && t.done_at)
      .map((t) => ({
        date: t.done_at as string,
        label: `Task completed: ${t.title}`,
      })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid #e8e7e0", paddingTop: 14 }}>
      <div className="grid2" style={{ marginBottom: 18 }}>
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Deal Pipeline</h4>
          {pipeline.map((p) => (
            <div
              key={p.st}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid #f0efe8",
              }}
            >
              <span>{STATUS_LABEL[p.st]}</span>
              <span className="muted">
                {p.count} · {money(p.value)}
              </span>
            </div>
          ))}
        </div>
        <div>
          <h4 style={{ margin: "0 0 8px" }}>Open Tasks</h4>
          {tasks.filter((t) => t.status !== "done").length === 0 ? (
            <p className="muted small">No open tasks for this client.</p>
          ) : (
            tasks
              .filter((t) => t.status !== "done")
              .map((t) => (
                <div key={t.id} style={{ padding: "6px 0" }}>
                  {t.title}
                  {t.due_date && (
                    <span className="muted small"> — due {formatDate(t.due_date)}</span>
                  )}
                </div>
              ))
          )}
        </div>
      </div>

      <h4 style={{ margin: "0 0 8px" }}>Activity Timeline</h4>
      {events.length === 0 ? (
        <p className="muted small">No activity yet.</p>
      ) : (
        <div className="stack-sm">
          {events.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid #f5f4ef",
              }}
            >
              <span>
                {e.label}
                {e.detail && <span className="muted small"> — {e.detail}</span>}
              </span>
              <span className="muted small nowrap">{formatDate(e.date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
