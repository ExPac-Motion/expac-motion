import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ShipmentTimeline from "../../components/ShipmentTimeline";
import ShipmentQuickUpdate from "../../components/ShipmentQuickUpdate";
import HousesSection from "../../components/HousesSection";
import TaskEditModal from "../ops/TaskEditModal";
import CommsRail from "./CommsRail";
import { ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime, money as formatZAR } from "../../lib/format";
import {
  useJobs,
  useOpsTasks,
  useProfiles,
  useCan,
  useQuote,
  useRevertJobToQuote,
  useSaveOpsTask,
  useShipmentDocuments,
} from "../../lib/hooks";
import { chargeTotals, fxOf, groupByCategory, packingRow, packingTotals, volumetricFactor } from "../../lib/calc";
import { OPTIONAL_STEP, stepLabel, todayIso, useJobTimeline, type TimelineStep } from "../../lib/timeline";
import { isShipmentComplete, type Job, type OpsTask, type ShipmentDocument } from "../../lib/types";
import {
  ConsolSection,
  CreateQuoteForJob,
  DocumentsSection,
  PodSection,
  ShipmentCards,
  ShipmentPodModal,
  codeOf,
} from "../JobsBoard";

/**
 * Shipment workspace (/jobs/:id): one page per shipment, where ops run it.
 * Header + summary strip (status, ETA, documents, tasks, health), progress,
 * and tabs: Overview, Timeline, Cargo, Documents, Tasks, Financials,
 * Activity. Built from the same pieces as the View window.
 */

const TABS = ["overview", "timeline", "cargo", "documents", "tasks", "financials", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  timeline: "Timeline",
  cargo: "Cargo",
  documents: "Documents",
  tasks: "Tasks",
  financials: "Financials",
  activity: "Activity",
};

/** Documents a shipment of this mode needs, by document type. */
export function requiredDocs(mode: string): { type: string; label: string }[] {
  const air = mode.startsWith("Air") || mode.startsWith("Courier");
  const sea = mode.startsWith("Sea");
  return [
    { type: "Commercial Invoice", label: "Commercial invoice" },
    { type: "Packing List", label: "Packing list" },
    ...(air ? [{ type: "HAWB", label: "HAWB (house air waybill)" }] : []),
    ...(sea ? [{ type: "HBL", label: "HBL (house bill of lading)" }] : []),
    ...(air || sea ? [{ type: "Bill of Lading / AWB", label: air ? "MAWB (master air waybill)" : "MBL (master bill of lading)" }] : []),
    { type: "Customs", label: "Customs entry / release" },
    { type: "Proof of Delivery", label: "Proof of delivery" },
  ];
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / 86_400_000);
}

/** On track / At risk / Delayed, from the ETA and the timeline's planned dates. */
export function shipmentHealth(
  job: Job,
  steps: TimelineStep[],
): { label: string; cls: "ok" | "risk" | "late" | "done"; why: string } {
  if (isShipmentComplete(job)) return { label: "Delivered", cls: "done", why: "Shipment delivered" };
  const today = todayIso();
  const arrived = steps.find((s) => s.step === "Arrived");
  if (job.eta && job.eta.slice(0, 10) < today && arrived && !arrived.done) {
    return { label: "Delayed", cls: "late", why: `ETA ${formatDate(job.eta)} has passed, not arrived yet` };
  }
  const overdue = steps.find(
    (s) => !s.done && !s.skipped && s.step !== OPTIONAL_STEP && s.planned_date && s.planned_date.slice(0, 10) < today,
  );
  if (overdue) {
    return {
      label: "At risk",
      cls: "risk",
      why: `${stepLabel(overdue.step, job.mode)} was planned for ${formatDate(overdue.planned_date)}`,
    };
  }
  return { label: "On track", cls: "ok", why: "No step is overdue" };
}

export default function ShipmentWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const jobsQ = useJobs();
  const job = (jobsQ.data ?? []).find((j) => j.id === id) ?? null;
  const stepsQ = useJobTimeline(id);
  const docsQ = useShipmentDocuments(id);
  const tasksQ = useOpsTasks();
  const quoteQ = useQuote(job?.quote_id ?? undefined);

  const [quick, setQuick] = useState(false);
  const revert = useRevertJobToQuote();
  const canDelete = useCan()("delete");
  const { toast, error: toastError } = useToast();
  // ?comms=1 (from a notification or the Inbox) opens Messages straight away.
  const [railOpen, setRailOpen] = useState(() => params.get("comms") === "1");
  const [railRemarks, setRailRemarks] = useState("");
  const openRail = (message = "") => {
    setRailRemarks(message);
    setRailOpen(true);
  };
  const [podJob, setPodJob] = useState<Job | null>(null);

  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const steps = stepsQ.data ?? [];
  const docs = docsQ.data ?? [];
  const tasks = useMemo(
    () => (tasksQ.data ?? []).filter((t) => t.job_id === id && t.kind === "task"),
    [tasksQ.data, id],
  );
  const openTasks = tasks.filter((t) => t.status !== "done");

  if (jobsQ.isLoading) return <Loading />;
  if (!job) return <ErrorNote error={new Error("Shipment not found")} />;

  const required = requiredDocs(job.mode);
  const have = required.filter((r) => docs.some((d) => d.doc_type === r.type));
  const health = shipmentHealth(job, steps);
  const counted = steps.filter((s) => !s.skipped && s.step !== OPTIONAL_STEP);
  const doneCount = counted.filter((s) => s.done).length;
  const pct = counted.length ? Math.round((doneCount / counted.length) * 100) : 0;
  const etaDays = job.eta ? daysBetween(todayIso(), job.eta) : null;
  const delivered = isShipmentComplete(job);
  const onDelivered = () => {
    if (!job.pod_signed_by && !job.pod_delivered_at) setPodJob(job);
  };
  const statusLabel = job.shipment_status ? stepLabel(job.shipment_status, job.mode) : job.milestone;
  // Customer not ready yet: back to Quote Sent, off the board, re-accept later.
  const canRevert = !!job.quote_id && !delivered && canDelete;
  async function onRevert() {
    if (!job) return;
    if (
      !window.confirm(
        `Move ${job.reference} back to Quote Sent?\n\nThe shipment is removed from Active Shipments, along with its emails, documents and tracking. The quotation stays and can be accepted again later.`,
      )
    )
      return;
    try {
      await revert.mutateAsync(job);
      toast(`${job.reference} moved back to Quote Sent`);
      navigate("/jobs");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not move it back to a quote");
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Shipments"
        title={job.reference}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate(delivered ? "/jobs/completed" : "/jobs")}>
              ← {delivered ? "Completed" : "Active"} shipments
            </button>
            {canRevert && (
              <button
                className="btn outline"
                onClick={onRevert}
                disabled={revert.isPending}
                title="Remove this shipment and put its quotation back to Quote Sent"
              >
                Back to Quote Sent
              </button>
            )}
            <button className="btn outline" onClick={() => openRail()}>
              Messages &amp; email
            </button>
            <button className="btn" onClick={() => setQuick(true)}>
              Quick update
            </button>
          </>
        }
      />

      <div className="ws-head panel">
        <div className="ws-title">
          <span className={`ws-status is-${health.cls}`}>{statusLabel}</span>
          <span className="ws-route">
            {job.mode} · <b>{codeOf(job.origin) || "—"}</b> → <b>{codeOf(job.destination) || "—"}</b>
          </span>
          <span className="ws-customer">{job.client?.company ?? "No customer"}</span>
        </div>
        <div className="ws-tiles">
          <div className="ws-tile">
            <span className="k">{delivered ? "Delivered" : "Estimated arrival"}</span>
            <b>{delivered ? formatDate(job.pod_delivered_at) : formatDate(job.eta)}</b>
            {!delivered && etaDays != null && (
              <span className={etaDays < 0 ? "late" : "muted"}>
                {etaDays === 0 ? "today" : etaDays > 0 ? `in ${etaDays} day${etaDays === 1 ? "" : "s"}` : `${-etaDays} day${etaDays === -1 ? "" : "s"} ago`}
              </span>
            )}
          </div>
          <button className="ws-tile" onClick={() => setTab("documents")}>
            <span className="k">Documents</span>
            <b>
              {have.length} / {required.length}
            </b>
            <span className="muted">{docs.length} on file</span>
          </button>
          <button className="ws-tile" onClick={() => setTab("tasks")}>
            <span className="k">Open tasks</span>
            <b>{openTasks.length}</b>
            <span className="muted">{tasks.length - openTasks.length} done</span>
          </button>
          <div className="ws-tile" title={health.why}>
            <span className="k">Job health</span>
            <b className={`ws-health is-${health.cls}`}>{health.label}</b>
            <span className="muted">{health.why}</span>
          </div>
        </div>
        <div className="ws-progress">
          <div className="ws-progress-k">
            <span>Shipment progress</span>
            <span className="muted">
              {doneCount} of {counted.length} steps
            </span>
          </div>
          <div className="tl-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <nav className="ws-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
            {t === "tasks" && openTasks.length > 0 && <span className="ws-count">{openTasks.length}</span>}
            {t === "documents" && have.length < required.length && (
              <span className="ws-count warn">{required.length - have.length}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="ws-body">
        {tab === "overview" && (
          <OverviewTab
            job={job}
            steps={steps}
            openTasks={openTasks}
            missingDocs={required.filter((r) => !have.includes(r))}
            onTab={setTab}
            onQuick={() => setQuick(true)}
            onEmail={() => openRail()}
          />
        )}
        {tab === "timeline" && <ShipmentTimeline job={job} onDelivered={onDelivered} onNotify={openRail} />}
        {tab === "cargo" && <CargoTab job={job} quote={quoteQ.data ?? null} loading={quoteQ.isLoading} />}
        {tab === "documents" && <DocumentsTab job={job} docs={docs} required={required} />}
        {tab === "tasks" && <TasksTab job={job} tasks={tasks} />}
        {tab === "financials" && <FinancialsTab job={job} quote={quoteQ.data ?? null} loading={quoteQ.isLoading} />}
        {tab === "activity" && <ActivityTab job={job} onMessages={() => openRail()} />}
      </div>

      <CommsRail job={job} open={railOpen} onToggle={() => setRailOpen((v) => !v)} initialRemarks={railRemarks} />
      {quick && (
        <ShipmentQuickUpdate
          job={job}
          onClose={() => setQuick(false)}
          onDelivered={onDelivered}
          onEmail={(m) => openRail(m)}
        />
      )}
      {podJob && <ShipmentPodModal job={podJob} onClose={() => setPodJob(null)} />}
    </>
  );
}

/* ---------- Overview ---------- */
function OverviewTab({
  job,
  steps,
  openTasks,
  missingDocs,
  onTab,
  onQuick,
  onEmail,
}: {
  job: Job;
  steps: TimelineStep[];
  openTasks: OpsTask[];
  missingDocs: { type: string; label: string }[];
  onTab: (t: Tab) => void;
  onQuick: () => void;
  onEmail: () => void;
}) {
  const lastDone = [...steps.filter((s) => !s.skipped)].reverse().find((s) => s.done);
  const next = steps.find(
    (s) => !s.done && !s.skipped && s.step !== OPTIONAL_STEP && s.sort_order > (lastDone?.sort_order ?? 0),
  );
  const actions: { key: string; text: string; go: () => void; cta: string }[] = [];
  if (next)
    actions.push({
      key: "next",
      text: `Move to ${stepLabel(next.step, job.mode)}${next.planned_date ? ` (planned ${formatDate(next.planned_date)})` : ""}`,
      go: onQuick,
      cta: "Quick update",
    });
  for (const t of openTasks.slice(0, 5))
    actions.push({
      key: t.id,
      text: t.title + (t.due_date ? ` · due ${formatDate(t.due_date)}` : ""),
      go: () => onTab("tasks"),
      cta: "Tasks",
    });
  if (missingDocs.length && !isShipmentComplete(job))
    actions.push({
      key: "docs",
      text: `Documents missing: ${missingDocs
        .filter((d) => d.type !== "Proof of Delivery")
        .map((d) => d.label)
        .join(", ") || "proof of delivery"}`,
      go: () => onTab("documents"),
      cta: "Documents",
    });

  return (
    <div className="ws-overview">
      <div className="ws-actions panel">
        <div className="ws-sec-head">
          <h3>Next actions</h3>
          <span className="ws-pill">{actions.length} pending</span>
        </div>
        {actions.length === 0 ? (
          <p className="muted">Nothing pending. ✓</p>
        ) : (
          <ul>
            {actions.map((a) => (
              <li key={a.key}>
                <span className="ws-bullet" />
                <span className="grow">{a.text}</span>
                <button className="btn ghost small" onClick={a.go}>
                  {a.cta} →
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="ws-keydates panel">
        <h3>Key dates</h3>
        {[
          ["Created", job.created_at],
          ["ETD", job.etd],
          ["ETA", job.eta],
          ["PDD", job.provisional_delivery_date],
          ["Delivered", job.pod_delivered_at ?? null],
        ].map(([k, v]) => (
          <div key={k as string} className="jv-field">
            <span className="k">{k}</span>
            <span className="v">{formatDate(v as string | null)}</span>
          </div>
        ))}
        <button className="link-btn" onClick={() => onTab("timeline")}>
          Full timeline →
        </button>
      </div>

      <div className="ws-wide">
        {!job.quote_id && <CreateQuoteForJob job={job} onDone={() => {}} />}
        <ShipmentCards job={job} onEmail={onEmail} />
        {job.notes && (
          <div className="jv-notes">
            <span className="k">Notes</span>
            <span>{job.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Cargo ---------- */
type QuoteData = NonNullable<ReturnType<typeof useQuote>["data"]>;

function CargoTab({ job, quote, loading }: { job: Job; quote: QuoteData | null; loading: boolean }) {
  const vFactor = volumetricFactor(job.mode);
  const packing = quote?.packing_list_items ?? [];
  const pack = packingTotals(packing, vFactor);
  const n2 = (v: number | string | null | undefined) =>
    (Number(v) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <>
      <div className="panel ws-panel">
        <div className="ws-sec-head">
          <h3>Cargo</h3>
          {quote && (
            <Link className="btn ghost small" to={`/quotes/${quote.id}`}>
              From quotation {quote.reference} →
            </Link>
          )}
        </div>
        {loading ? (
          <Loading />
        ) : !quote ? (
          <p className="muted">No quotation linked, so no packing list.</p>
        ) : (
          <>
            <div className="ws-facts">
              <div>
                <span className="k">Commodity</span>
                <b>{quote.commodity || "—"}</b>
              </div>
              <div>
                <span className="k">Incoterms</span>
                <b>{quote.incoterms || "—"}</b>
              </div>
              <div>
                <span className="k">Pieces / cartons</span>
                <b>
                  {pack.pcs} pcs · {pack.qty} ctns
                </b>
              </div>
              <div>
                <span className="k">Chargeable</span>
                <b>
                  {n2(pack.chargeable)} kg · {n2(pack.totalCbm)} CBM
                </b>
              </div>
            </div>
            {packing.length === 0 ? (
              <p className="muted">No packing lines on the quotation.</p>
            ) : (
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr>
                      {["L (cm)", "W (cm)", "H (cm)", "Act (Kg)", "Qty (Pcs)", "Qty (Ctns)", "CBM (Ctn)", "Volume (Kg)", "Ttl (Cbm)", "Ttl Act (Kg)", "Ttl Vol (Kg)"].map((h) => (
                        <th key={h} style={{ textAlign: "right" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {packing.map((p, i) => {
                      const r = packingRow(p, vFactor);
                      return (
                        <tr key={p.id ?? i}>
                          {[p.length_cm, p.width_cm, p.height_cm, p.actual_kg, p.qty_pcs, p.qty_ctns, r.cbm, r.volumeKg, r.totalCbm, r.totalActual, r.totalVolume].map((v, k) => (
                            <td key={k} style={{ textAlign: "right" }}>
                              {n2(v)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <div className="panel ws-panel jv-extras">
        <PodSection job={job} />
        <ConsolSection job={job} />
        <HousesSection job={job} />
      </div>
    </>
  );
}

/* ---------- Documents ---------- */
function DocumentsTab({
  job,
  docs,
  required,
}: {
  job: Job;
  docs: ShipmentDocument[];
  required: { type: string; label: string }[];
}) {
  return (
    <>
      <div className="panel ws-panel">
        <div className="ws-sec-head">
          <h3>Document checklist</h3>
          <span className="muted">Upload below, choosing the matching document type</span>
        </div>
        <ul className="ws-checklist">
          {required.map((r) => {
            const found = docs.filter((d) => d.doc_type === r.type);
            return (
              <li key={r.type} className={found.length ? "ok" : ""}>
                <span className="ws-check">{found.length ? "✓" : ""}</span>
                <span className="grow">{r.label}</span>
                <span className="muted">
                  {found.length
                    ? found.map((d) => d.name).join(", ")
                    : r.type === "Proof of Delivery" && !isShipmentComplete(job)
                      ? "after delivery"
                      : "missing"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="panel ws-panel">
        <DocumentsSection job={job} />
      </div>
    </>
  );
}

/* ---------- Tasks ---------- */
function TasksTab({ job, tasks }: { job: Job; tasks: OpsTask[] }) {
  const save = useSaveOpsTask();
  const { error: toastError } = useToast();
  const [editing, setEditing] = useState<OpsTask | null | "new">(null);
  const sorted = [...tasks].sort(
    (a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"),
  );
  function toggle(t: OpsTask) {
    const status = t.status === "done" ? "open" : "done";
    save.mutate(
      { id: t.id, values: { status, done_at: status === "done" ? new Date().toISOString() : null } },
      { onError: (e) => toastError(e instanceof Error ? e.message : "Could not update the task") },
    );
  }
  return (
    <div className="panel ws-panel">
      <div className="ws-sec-head">
        <h3>Tasks</h3>
        <button className="btn small" onClick={() => setEditing("new")}>
          + Add task
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className="muted">No tasks for this shipment.</p>
      ) : (
        <ul className="ws-tasks">
          {sorted.map((t) => (
            <li key={t.id} className={t.status === "done" ? "done" : ""}>
              <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} aria-label={`Done: ${t.title}`} />
              <button className="link-btn grow" onClick={() => setEditing(t)}>
                {t.title}
              </button>
              {t.priority === "high" && <span className="tag">High</span>}
              <span className="muted">
                {t.status === "done"
                  ? `done ${formatDate(t.done_at)}`
                  : t.due_date
                    ? `due ${formatDate(t.due_date)}`
                    : t.status === "doing"
                      ? "in progress"
                      : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TaskEditModal
          task={editing === "new" ? null : editing}
          defaults={{ job_id: job.id, client_id: job.client_id, title: "" }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ---------- Financials ---------- */
function FinancialsTab({ job, quote, loading }: { job: Job; quote: QuoteData | null; loading: boolean }) {
  if (loading) return <Loading />;
  if (!quote)
    return (
      <div className="panel ws-panel">
        <p className="muted">No quotation linked, so no figures to show.</p>
      </div>
    );
  const t = chargeTotals(quote.quote_lines, fxOf(quote));
  const groups = groupByCategory(quote.quote_lines).filter((g) => g.lines.length > 0);
  return (
    <div className="panel ws-panel">
      <div className="ws-sec-head">
        <h3>Financials</h3>
        <Link className="btn ghost small" to={`/quotes/${quote.id}`}>
          Quotation {quote.reference} →
        </Link>
      </div>
      <div className="ws-money">
        <div>
          <span className="k">Sell (excl. VAT)</span>
          <b>{formatZAR(t.sell)}</b>
        </div>
        <div>
          <span className="k">Cost</span>
          <b>{formatZAR(t.cost)}</b>
        </div>
        <div>
          <span className="k">Gross profit</span>
          <b className={t.gp < 0 ? "late" : "ok"}>{formatZAR(t.gp)}</b>
        </div>
        <div>
          <span className="k">Margin</span>
          <b>{t.margin.toFixed(1)}%</b>
        </div>
        <div>
          <span className="k">Total incl. VAT</span>
          <b>{formatZAR(t.sellIncl)}</b>
        </div>
      </div>
      <table className="table--compact ws-money-table">
        <thead>
          <tr>
            <th>Section</th>
            <th style={{ textAlign: "right" }}>Lines</th>
            <th style={{ textAlign: "right" }}>Sell (excl. VAT)</th>
            <th style={{ textAlign: "right" }}>VAT</th>
            <th style={{ textAlign: "right" }}>Incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.category}>
              <td>{g.category}</td>
              <td style={{ textAlign: "right" }}>{g.lines.length}</td>
              <td style={{ textAlign: "right" }}>{formatZAR(g.subtotal)}</td>
              <td style={{ textAlign: "right" }}>{formatZAR(g.vat)}</td>
              <td style={{ textAlign: "right" }}>{formatZAR(g.subtotalIncl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="jv-field" style={{ marginTop: 12 }}>
        <span className="k">Invoice</span>
        <span className="v">
          {job.invoice_no ? `${job.invoice_no}${job.invoiced_at ? " · " + formatDate(job.invoiced_at) : ""}` : "Not invoiced yet"}
        </span>
      </div>
      <p className="muted ws-foot">Figures are the quotation's, in ZAR at its exchange rates.</p>
    </div>
  );
}

/* ---------- Activity ---------- */
function ActivityTab({ job, onMessages }: { job: Job; onMessages: () => void }) {
  const profiles = useProfiles().data ?? [];
  const nameOf = (uid: string | null | undefined) => profiles.find((p) => p.id === uid)?.full_name || null;
  const events = [...(job.job_events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <div className="panel ws-panel">
      <div className="ws-sec-head">
        <h3>History</h3>
        <button className="btn outline small" onClick={onMessages}>
          Messages &amp; emails →
        </button>
      </div>
      {events.length === 0 ? (
        <p className="muted">Nothing logged yet.</p>
      ) : (
        <ol className="ws-history">
          {events.map((e) => {
            const who = nameOf((e as { created_by?: string | null }).created_by);
            return (
              <li key={e.id}>
                <span className="when">{formatDateTime(e.created_at)}</span>
                <span className="what">{e.note || `Milestone: ${e.milestone}`}</span>
                {who && <span className="muted">{who}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
