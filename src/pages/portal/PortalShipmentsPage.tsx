import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, RowActions, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useMyDocuments, useMyDocumentsAll, useMyJobTracking, useMyJobs, useMyMessages, useSendMyMessage } from "../../lib/hooks";
import { getMyDocumentUrl } from "../../lib/db";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import { DELIVERED_STATUS, shipmentStatusSlug, type ClientJob } from "../../lib/types";
import {
  commsSeen,
  markCommsSeen,
  useCreatePortalTask,
  usePortalMsgStamps,
  usePortalQuotes,
  usePortalTasks,
  type PortalTask,
} from "../../lib/portal";

type ModeTab = "All" | "Air" | "Courier" | "Sea" | "Road";
const MODE_TABS: { key: ModeTab; label: string }[] = [
  { key: "All", label: "All Shipments" },
  { key: "Air", label: "Air Freight" },
  { key: "Courier", label: "Courier Express" },
  { key: "Sea", label: "Sea Freight" },
  { key: "Road", label: "Road Freight" },
];
const modeOf = (m: string): ModeTab =>
  m.startsWith("Air") ? "Air" : m.startsWith("Courier") ? "Courier" : m.startsWith("Sea") ? "Sea" : "Road";
const isDone = (j: ClientJob) => j.shipment_status === DELIVERED_STATUS || j.milestone === "Delivered";
const code = (s: string | null | undefined) => {
  const c = s ? portCode(s) : "";
  return c === "—" ? "" : c;
};
function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
}

/**
 * Customer Portal › Shipments: the same board as ExPac's Active Shipments,
 * from the customer's side, read only, no notes / invoicing / duplicate /
 * delete; with Shipment Comms (the per-shipment chat with ExPac) and shipment
 * tasks (ask ExPac for something; ExPac's shared tasks show here too).
 */
export default function PortalShipmentsPage() {
  const jobsQ = useMyJobs();
  const trackQ = useMyJobTracking();
  const tasksQ = usePortalTasks();
  const stampsQ = usePortalMsgStamps();
  const [view, setView] = useState<"active" | "completed">("active");
  const [modeTab, setModeTab] = useState<ModeTab>("All");
  const [search, setSearch] = useState("");
  const [commsJob, setCommsJob] = useState<ClientJob | null>(null);
  const [taskJob, setTaskJob] = useState<ClientJob | null>(null);
  const [viewJob, setViewJob] = useState<ClientJob | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [, bump] = useState(0);

  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  // Proof of delivery documents (0151), newest per shipment.
  const allDocsQ = useMyDocumentsAll();
  const podDocs = useMemo(() => {
    const m = new Map<string, { storage_path: string; created_at: string }>();
    for (const d of allDocsQ.data ?? []) if (d.doc_type === "Proof of Delivery" && !m.has(d.job_id)) m.set(d.job_id, d);
    return m;
  }, [allDocsQ.data]);
  const track = useMemo(() => new Map((trackQ.data ?? []).map((t) => [t.job_id, t])), [trackQ.data]);
  const etaOf = (j: ClientJob) => track.get(j.id)?.pod_eta || track.get(j.id)?.eta || j.eta;
  const etdOf = (j: ClientJob) => track.get(j.id)?.etd || j.etd;
  const openTaskJobs = useMemo(
    () => new Set((tasksQ.data ?? []).filter((t) => t.status !== "done").map((t) => t.job_id)),
    [tasksQ.data],
  );
  // Unread = a message from ExPac newer than when this browser last opened that shipment's comms.
  const unread = (j: ClientJob) => {
    const seen = commsSeen(j.id);
    return (stampsQ.data ?? []).some((m) => m.job_id === j.id && m.direction === "out" && m.created_at > seen);
  };

  const stageRows = jobs.filter((j) => (view === "completed" ? isDone(j) : !isDone(j)));
  const n = search.trim().toLowerCase();
  const rows = stageRows.filter(
    (j) =>
      (modeTab === "All" || modeOf(j.mode) === modeTab) &&
      (!n ||
        [j.reference, j.supplier_company, j.po_no, j.awb_mbl, j.container_no, j.origin, j.destination, j.shipping_line, j.carrier_name]
          .join(" ")
          .toLowerCase()
          .includes(n)),
  );

  function openComms(j: ClientJob) {
    setCommsJob(j);
    markCommsSeen(j.id);
    bump((x) => x + 1);
  }

  const columns: DataColumn<ClientJob>[] = [
    {
      key: "actions",
      fixed: true,
      width: 120,
      header: <span className="pt-act-head">Actions</span>,
      render: (j) => (
        <div className="pt-rowacts">
          <RowActions
            onMail={() => openComms(j)}
            mailTitle="Shipment Comms, chat with ExPac"
            mailUnread={unread(j)}
            onTask={() => setTaskJob(j)}
            taskTitle="Tasks, ask ExPac for something on this shipment"
            taskOpen={openTaskJobs.has(j.id)}
            onView={() => setViewJob(j)}
          />
        </div>
      ),
    },
    { key: "created", header: "Created On", width: 110, render: (j) => formatDate(j.created_at), sortValue: (j) => j.created_at },
    {
      key: "shipment",
      header: "Shipment",
      width: 130,
      render: (j) => (
        <button type="button" className="link-btn job-ref" onClick={() => setViewJob(j)}>
          {j.reference}
        </button>
      ),
      sortValue: (j) => j.reference,
    },
    { key: "shipper", header: "Shipper", width: 180, render: (j) => j.supplier_company || "—", sortValue: (j) => j.supplier_company ?? "" },
    { key: "reference", header: "REF", width: 120, render: (j) => j.po_no || "—", sortValue: (j) => j.po_no ?? "" },
    { key: "mode", header: "Mode", width: 140, render: (j) => j.mode, sortValue: (j) => j.mode },
    {
      key: "status",
      header: view === "completed" ? "Shipment Status" : "Status",
      width: 160,
      render: (j) => <span className={`job-status job-status-ro is-${shipmentStatusSlug(j.shipment_status)}`}>{j.shipment_status || j.milestone}</span>,
      sortValue: (j) => j.shipment_status ?? "",
    },
    { key: "awb", header: "AWB/MBL No", width: 150, render: (j) => j.awb_mbl || "—", sortValue: (j) => j.awb_mbl ?? "" },
    { key: "container", header: "Container No", width: 150, render: (j) => j.container_no || "—" },
    {
      key: "line",
      header: "Shipping Line",
      width: 150,
      render: (j) => j.shipping_line || "—",
    },
    { key: "carrier", header: "Airline", width: 150, render: (j) => j.carrier_name || "—" },
    { key: "etd", header: "ETD", width: 110, render: (j) => formatDate(etdOf(j)), sortValue: (j) => etdOf(j) ?? "" },
    {
      key: "eta",
      header: "ETA",
      width: 120,
      render: (j) => {
        const d = daysUntil(etaOf(j));
        const flag = view === "active" && d !== null && d <= 5;
        return (
          <span
            className={flag ? "job-eta is-due" : undefined}
            title={d === null ? undefined : d < 0 ? `ETA passed ${-d} day(s) ago` : d === 0 ? "Arriving today" : `Arriving in ${d} day(s)`}
          >
            {formatDate(etaOf(j))}
          </span>
        );
      },
      sortValue: (j) => etaOf(j) ?? "",
    },
    {
      key: "pod",
      header: "POD",
      width: 110,
      render: (j) => {
        const doc = podDocs.get(j.id);
        if (!doc && !j.pod_delivered_at) return "—";
        return doc ? (
          <button
            type="button"
            className="link-btn"
            title={j.pod_signed_by ? "Signed for by " + j.pod_signed_by : "Proof of delivery"}
            onClick={async (e) => {
              e.stopPropagation();
              const tab = window.open("", "_blank");
              try {
                const url = await getMyDocumentUrl(doc.storage_path);
                if (tab) tab.location.href = url;
              } catch {
                tab?.close();
              }
            }}
          >
            ✓ {formatDate(j.pod_delivered_at ?? doc.created_at)}
          </button>
        ) : (
          "✓ " + formatDate(j.pod_delivered_at)
        );
      },
      sortValue: (j) => j.pod_delivered_at ?? "",
    },
    { key: "pdd", header: "PDD", width: 110, render: (j) => formatDate(j.provisional_delivery_date), sortValue: (j) => j.provisional_delivery_date ?? "" },
    { key: "pol", header: "POL", width: 100, render: (j) => code(j.origin) || "—" },
    { key: "pod", header: "POD", width: 100, render: (j) => code(j.destination) || "—" },
  ];

  return (
    <>
      <div className={commsJob ? "board-shift" : ""}>
        <PageHeader eyebrow="Your shipments" title={view === "completed" ? "Completed Shipments" : "Active Shipments"} />
        <PageTools
          search={<SearchInput value={search} onChange={setSearch} placeholder="Search shipment, shipper, PO, AWB / B/L, container…" />}
          filters={
            <>
              <div className="wms-seg">
                <button type="button" className={view === "active" ? "active" : ""} onClick={() => setView("active")}>
                  Active
                </button>
                <button type="button" className={view === "completed" ? "active" : ""} onClick={() => setView("completed")}>
                  Completed
                </button>
              </div>
              <div className="wms-seg">
                {MODE_TABS.map((t) => (
                  <button key={t.key} type="button" className={modeTab === t.key ? "active" : ""} onClick={() => setModeTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          }
          count={jobsQ.isLoading ? undefined : `${rows.length} shipment${rows.length === 1 ? "" : "s"}`}
          onToolsSlot={setToolsSlot}
        />
        <div className="panel jobs-panel">
          {jobsQ.isLoading ? (
            <Loading />
          ) : jobsQ.isError ? (
            <ErrorNote error={jobsQ.error} />
          ) : rows.length === 0 ? (
            <EmptyState>
              {n ? `No shipments match "${search.trim()}".` : view === "completed" ? "No completed shipments yet." : "No active shipments right now."}
            </EmptyState>
          ) : (
            <DataTable
              tableKey={`portal-jobs-${view}`}
              className="table--compact"
              toolsPortal={toolsSlot}
              columns={columns}
              rows={rows}
              rowKey={(j) => j.id}
              onRowClick={(j) => setViewJob(j)}
            />
          )}
        </div>
      </div>
      {commsJob && <PortalCommsRail job={commsJob} onClose={() => setCommsJob(null)} />}
      {viewJob && <PortalShipmentViewModal job={viewJob} eta={etaOf(viewJob)} etd={etdOf(viewJob)} onClose={() => setViewJob(null)} />}
      {taskJob && <PortalTasksModal job={taskJob} tasks={(tasksQ.data ?? []).filter((t) => t.job_id === taskJob.id)} onClose={() => setTaskJob(null)} />}
    </>
  );
}

/** Shipment Comms, the shipment's message history with ExPac, docked right
 *  like the Activity Panel on ExPac's board. */
function PortalCommsRail({ job, onClose }: { job: ClientJob; onClose: () => void }) {
  const qc = useQueryClient();
  const { error } = useToast();
  const msgsQ = useMyMessages(job.id);
  const send = useSendMyMessage();
  const [draft, setDraft] = useState("");
  const messages = msgsQ.data ?? [];

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    try {
      await send.mutateAsync({ jobId: job.id, body });
      setDraft("");
      markCommsSeen(job.id);
      qc.invalidateQueries({ queryKey: ["portal", "msgstamps"] });
    } catch (er) {
      error(er instanceof Error ? er.message : "Could not send");
    }
  }

  return (
    <aside className="comms-rail">
      <div className="comms-rail-head">
        <div>
          <div className="comms-rail-eyebrow">Shipment Comms</div>
          <strong>{job.reference}</strong>
          <div className="hint">
            {job.mode} · {code(job.origin) || "—"} → {code(job.destination) || "—"}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">
          ›
        </button>
      </div>
      <div className="comms-rail-body">
        <form onSubmit={onSend} className="pt-comms-compose">
          <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write to the ExPac team about this shipment…" />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-sm" disabled={send.isPending || !draft.trim()}>
              {send.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
        {msgsQ.isLoading ? (
          <Loading />
        ) : messages.length === 0 ? (
          <p className="hint">No messages on this shipment yet.</p>
        ) : (
          <div className="msg-thread">
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.direction === "in" ? "in" : ""}`}>
                <div className="msg-top">
                  <span className="msg-kind">{m.direction === "in" ? "You" : "ExPac"}</span>
                  <span className="msg-when">{formatDateTime(m.created_at)}</span>
                </div>
                {m.subject && <div className="msg-subject">{m.subject}</div>}
                <pre className="msg-body">{m.body}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Shipment tasks, what the customer asked ExPac for, and tasks ExPac shares;
 *  plus "+ New task" to ask for something. */
function PortalTasksModal({ job, tasks, onClose }: { job: ClientJob; tasks: PortalTask[]; onClose: () => void }) {
  const { toast, error } = useToast();
  const create = useCreatePortalTask();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const STATUS: Record<PortalTask["status"], string> = { open: "Open", doing: "In progress", done: "Done" };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return error("What do you need?");
    create.mutate(
      { jobId: job.id, title: title.trim(), body, due },
      {
        onSuccess: () => {
          toast("Sent to ExPac, the team has been notified");
          setTitle("");
          setBody("");
          setDue("");
        },
        onError: (er) => error(er.message),
      },
    );
  }

  return (
    <Modal title={`Tasks, ${job.reference}`} onClose={onClose} wide>
      {tasks.length === 0 ? (
        <p className="hint" style={{ marginTop: 0 }}>
          No tasks on this shipment yet.
        </p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th>Task</th>
              <th>From</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <b>{t.title}</b>
                  {t.body && <div className="hint">{t.body}</div>}
                </td>
                <td>{t.from_portal ? "You" : "ExPac"}</td>
                <td>{formatDate(t.due_date)}</td>
                <td>
                  <span className={`badge ${t.status === "done" ? "completed" : t.status === "doing" ? "sent" : "open"}`}>{STATUS[t.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h4 className="wms-subhead">Ask ExPac for something on this shipment</h4>
      <form onSubmit={submit}>
        <div className="grid3">
          <div className="field" style={{ gridColumn: "span 2" }}>
            <label>What do you need?</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Please deliver Friday morning / Send the updated invoice" />
          </div>
          <div className="field">
            <label>Needed by</label>
            <DateInput value={due} onChange={setDue} />
          </div>
        </div>
        <div className="field">
          <label>Details</label>
          <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="modal-foot-row">
          <button type="button" className="btn outline" onClick={onClose}>
            Close
          </button>
          <button className="btn" disabled={create.isPending}>
            {create.isPending ? "Sending…" : "+ Send task to ExPac"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const docLabel = (mode: string) =>
  mode.startsWith("Air") || mode.startsWith("Courier") ? "AWB No" : mode.startsWith("Sea") ? "MBL No" : "Ref No";

function ViewField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}

/** The shipment View, same layout as ExPac's Active Shipments view (no
 *  notes / customer field); documents are the ones ExPac shares. */
export function PortalShipmentViewModal({
  job,
  eta,
  etd,
  onClose,
}: {
  job: ClientJob;
  eta: string | null | undefined;
  etd: string | null | undefined;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { error } = useToast();
  const docsQ = useMyDocuments(job.id);
  const quotesQ = usePortalQuotes();
  // A shipment keeps its quotation's system number.
  const quote = (quotesQ.data ?? []).find((q) => q.reference === job.reference);

  async function open(path: string) {
    const tab = window.open("", "_blank");
    try {
      const url = await getMyDocumentUrl(path);
      if (tab) tab.location.href = url;
    } catch (e) {
      tab?.close();
      error(e instanceof Error ? e.message : "Could not open the document");
    }
  }

  return (
    <Modal
      title={job.reference}
      onClose={onClose}
      wide
      headerActions={
        <button className="btn outline" onClick={() => navigate(`/portal/shipments/${job.id}`)}>
          Track shipment
        </button>
      }
    >
      <div className="grid2">
        <ViewField label="Shipper" value={job.supplier_company ?? "—"} />
        <ViewField label="Mode" value={job.mode} />
        <ViewField label="Milestone" value={job.milestone} />
        <ViewField label="Shipment Status" value={job.shipment_status || "—"} />
        <ViewField label="REF" value={job.po_no || "—"} />
        <ViewField label={docLabel(job.mode)} value={job.awb_mbl || "—"} />
        <ViewField label="Container No" value={job.container_no || "—"} />
        <ViewField label="Shipping Line" value={job.shipping_line || "—"} />
        <ViewField label="Airline" value={job.carrier_name || "—"} />
        <ViewField label="Vessel" value={job.vessel_name || "—"} />
        <ViewField label="POL" value={code(job.origin) || "—"} />
        <ViewField label="POD" value={code(job.destination) || "—"} />
        <ViewField label="ETD" value={formatDate(etd)} />
        <ViewField label="ETA" value={formatDate(eta)} />
        <ViewField label="PDD" value={formatDate(job.provisional_delivery_date)} />
        <ViewField label="Created On" value={formatDate(job.created_at)} />
      </div>
      {quote && (
        <p style={{ marginTop: 8 }}>
          <Link to={`/portal/quotes/${quote.id}`} onClick={onClose}>
            View originating quotation →
          </Link>
        </p>
      )}

      <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        {(job.pod_delivered_at || job.pod_signed_by) && (
          <p className="pt-note ok" style={{ marginTop: 0 }}>
            Delivered {formatDate(job.pod_delivered_at)}
            {job.pod_signed_by ? ", signed for by " + job.pod_signed_by : ""}. The signed proof of delivery is in the documents below.
          </p>
        )}
        <strong>Documents</strong>
        {docsQ.isLoading ? (
          <Loading />
        ) : (docsQ.data ?? []).length === 0 ? (
          <p className="hint">No documents shared on this shipment yet.</p>
        ) : (
          <table className="table--compact" style={{ marginTop: 8 }}>
            <tbody>
              {(docsQ.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>
                    <button type="button" className="link-btn" onClick={() => void open(d.storage_path)}>
                      {d.name}
                    </button>
                  </td>
                  <td>{d.doc_type || "—"}</td>
                  <td>{formatDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
