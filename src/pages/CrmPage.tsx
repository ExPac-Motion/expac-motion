import { useMemo, useState } from "react";
import Modal from "../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../components/common";
import {
  useClients,
  useJobs,
  useMessagesForJobs,
  useOpsTasks,
  useQuotes,
  useShipmentDocumentsForJobs,
} from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { formatDate, money } from "../lib/format";
import {
  isShipmentComplete,
  STATUS_LABEL,
  STATUS_ORDER,
  type Client,
  type Job,
  type Quote,
} from "../lib/types";

export default function CrmPage() {
  const clientsQ = useClients();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const [openClient, setOpenClient] = useState<Client | null>(null);

  const quotes = quotesQ.data ?? [];
  const jobs = jobsQ.data ?? [];

  const rows = useMemo(() => {
    const clients = clientsQ.data ?? [];
    const quotes = quotesQ.data ?? [];
    const jobs = jobsQ.data ?? [];
    return clients.map((c) => {
      const cQuotes = quotes.filter((q) => q.client_id === c.id);
      const cJobs = jobs.filter((j) => j.client_id === c.id);
      const activeShipments = cJobs.filter((j) => !isShipmentComplete(j));
      const lastActivity = [
        ...cQuotes.map((q) => q.created_at),
        ...cJobs.map((j) => j.created_at),
      ].sort()[cQuotes.length + cJobs.length - 1];
      return {
        client: c,
        openQuotes: cQuotes.filter((q) => q.status === "open" || q.status === "sent")
          .length,
        activeShipments: activeShipments.length,
        lastActivity,
      };
    });
  }, [clientsQ.data, quotesQ.data, jobsQ.data]);

  const isLoading = clientsQ.isLoading || quotesQ.isLoading || jobsQ.isLoading;
  const isError = clientsQ.isError || quotesQ.isError || jobsQ.isError;

  return (
    <>
      <PageHeader eyebrow="Client relationships" title="CRM" />
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Customers</h2>
            <p>{rows.length} total · pipeline, activity and tasks per client</p>
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={clientsQ.error ?? quotesQ.error ?? jobsQ.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No customers yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Open Quotes</th>
                  <th>Active Shipments</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.client.id}
                    className="clickable"
                    onClick={() => setOpenClient(r.client)}
                  >
                    <td>
                      <strong>{r.client.company}</strong>
                    </td>
                    <td>{r.openQuotes}</td>
                    <td>{r.activeShipments}</td>
                    <td>{r.lastActivity ? formatDate(r.lastActivity) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openClient && (
        <CrmClientModal
          client={openClient}
          quotes={quotes.filter((q) => q.client_id === openClient.id)}
          jobs={jobs.filter((j) => j.client_id === openClient.id)}
          onClose={() => setOpenClient(null)}
        />
      )}
    </>
  );
}

function CrmClientModal({
  client,
  quotes,
  jobs,
  onClose,
}: {
  client: Client;
  quotes: Quote[];
  jobs: Job[];
  onClose: () => void;
}) {
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const tasksQ = useOpsTasks();
  const messagesQ = useMessagesForJobs(jobIds);
  const docsQ = useShipmentDocumentsForJobs(jobIds);

  const tasks = (tasksQ.data ?? []).filter((t) => t.client_id === client.id);

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
    <Modal title={client.company} onClose={onClose} wide stickyHeader>
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
    </Modal>
  );
}
