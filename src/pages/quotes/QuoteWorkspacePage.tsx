import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import QuoteCommsRail from "./QuoteCommsRail";
import QuoteDetailBody, { quoteFigures } from "./QuoteDetailBody";
import TimelineProgress from "../../components/TimelineProgress";
import { ErrorNote, Loading, PageHeader, StatusBadge, useBackTo } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, money } from "../../lib/format";
import { useAcceptQuote, useCan, useDeleteQuote, useJobs, useOpsTasks, useQuote } from "../../lib/hooks";
import { statusLabel } from "../../lib/steps";
import { todayIso, useJobTimeline } from "../../lib/timeline";
import { WON_QUOTE_STATUSES, type Job } from "../../lib/types";
import { RecordTasks } from "../shipments/ShipmentWorkspacePage";

/**
 * Quote page (/quotes/:id/view): one page per quotation, same build as the
 * shipment workspace. Header actions, a summary strip (customer, total,
 * validity, stage, tasks), and tabs: Overview (next actions, key facts,
 * notes), Details & charges, Tasks, Shipment (once accepted). Replaces the
 * quote View pop-up.
 */

const TABS = ["overview", "charges", "tasks", "shipment"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  charges: "Details & charges",
  tasks: "Tasks",
  shipment: "Shipment",
};

const daysFrom = (iso: string, to = todayIso()) =>
  Math.round((Date.parse(to.slice(0, 10)) - Date.parse(iso.slice(0, 10))) / 86_400_000);

export default function QuoteWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { toast, error: toastError } = useToast();
  const quoteQ = useQuote(id);
  const jobsQ = useJobs();
  const tasksQ = useOpsTasks();
  const accept = useAcceptQuote();
  const del = useDeleteQuote();
  const canDelete = useCan()("delete");
  const goBack = useBackTo("/quotes");
  const [railOpen, setRailOpen] = useState(() => params.get("comms") === "1");

  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "overview";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === "overview") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };

  const tasks = useMemo(
    () => (tasksQ.data ?? []).filter((t) => t.quote_id === id && t.kind === "task"),
    [tasksQ.data, id],
  );
  const openTasks = tasks.filter((t) => t.status !== "done");
  const job = (jobsQ.data ?? []).find((j) => j.quote_id === id) ?? null;

  if (quoteQ.isLoading) return <Loading />;
  const q = quoteQ.data;
  if (!q) return <ErrorNote error={new Error("Quotation not found")} />;

  const { t } = quoteFigures(q);
  const priced = q.quote_lines.length > 0;
  const won = WON_QUOTE_STATUSES.includes(q.status);
  const party = q.client?.company ?? (q.lead?.company ? `${q.lead.company} (lead)` : "No customer");
  const validDays = q.valid_until ? daysFrom(todayIso(), q.valid_until) : null;
  const sentDays = q.sent_at ? daysFrom(q.sent_at) : null;

  async function onAccept() {
    if (!q) return;
    try {
      const jobId = await accept.mutateAsync(q.id);
      toast("Shipment created");
      navigate(jobId ? `/jobs/${jobId}` : "/jobs");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not accept quote");
    }
  }
  async function onDelete() {
    if (!q || !window.confirm(`Delete ${q.reference}? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(q.id);
      toast("Quote deleted");
      navigate("/quotes");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not delete");
    }
  }

  // Next actions, most urgent first.
  const actions: { key: string; text: string; cta: string; go: () => void }[] = [];
  if (q.portal_decision === "accepted" && !won)
    actions.push({ key: "portal", text: "Customer accepted on the portal, create the shipment", cta: "Accept", go: onAccept });
  if (q.revision_pending)
    actions.push({ key: "rev", text: "Customer asked for a revision", cta: "Edit quote", go: () => navigate(`/quotes/${q.id}`) });
  if (!priced)
    actions.push({ key: "price", text: "Not priced yet, add the charges", cta: "Edit quote", go: () => navigate(`/quotes/${q.id}`) });
  else if (q.status === "open")
    actions.push({ key: "send", text: "Priced, send it to the customer", cta: "Messages", go: () => setRailOpen(true) });
  if (q.status === "sent" && sentDays != null && sentDays >= 3)
    actions.push({ key: "follow", text: `Follow up, sent ${sentDays} days ago`, cta: "Messages", go: () => setRailOpen(true) });
  if (!won && q.status !== "lost" && validDays != null && validDays <= 3)
    actions.push({
      key: "valid",
      text: validDays < 0 ? `Expired ${formatDate(q.valid_until)}, revise or extend` : `Valid until ${formatDate(q.valid_until)}, expires soon`,
      cta: "Edit quote",
      go: () => navigate(`/quotes/${q.id}`),
    });
  for (const tk of openTasks.slice(0, 5))
    actions.push({ key: tk.id, text: tk.title + (tk.due_date ? ` · due ${formatDate(tk.due_date)}` : ""), cta: "Tasks", go: () => setTab("tasks") });
  if (job) actions.push({ key: "job", text: `Shipment ${job.reference} is running`, cta: "Open shipment", go: () => navigate(`/jobs/${job.id}`) });

  const tabs = TABS.filter((x) => x !== "shipment" || job);

  return (
    <>
      <PageHeader
        eyebrow="Quotations"
        title={q.reference}
        actions={
          <>
            <button className="btn outline" onClick={goBack}>
              ← Quotations
            </button>
            <button className="btn outline" onClick={() => setRailOpen(true)}>
              Messages &amp; email
            </button>
            <Link className="btn outline" to={`/quotes/${q.id}/print`}>
              Quotation document
            </Link>
            <Link className="btn outline" to={`/quotes/${q.id}`}>
              Edit quote
            </Link>
            {canDelete && !job && (
              <button className="btn danger" onClick={onDelete} disabled={del.isPending}>
                Delete
              </button>
            )}
            {job ? (
              <Link className="btn" to={`/jobs/${job.id}`}>
                Open shipment {job.reference}
              </Link>
            ) : !won ? (
              <button className="btn" onClick={onAccept} disabled={accept.isPending}>
                {accept.isPending ? "Working…" : "Accept & create shipment"}
              </button>
            ) : null}
          </>
        }
      />

      <div className="ws-head panel">
        <div className="ws-title">
          <StatusBadge status={q.status} />
          <span className="ws-route">
            {q.mode} · <b>{q.origin || "—"}</b> → <b>{q.destination || "—"}</b>
          </span>
          <span className="ws-customer">{party}</span>
        </div>
        <div className="ws-tiles">
          <div className="ws-tile">
            <span className="k">Total incl. VAT</span>
            <b>{priced ? money(t.sellIncl) : "Not priced"}</b>
            {priced && (
              <span className="muted">
                GP {money(t.gp)} · {t.margin.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="ws-tile">
            <span className="k">Valid until</span>
            <b>{formatDate(q.valid_until)}</b>
            {validDays != null && !won && (
              <span className={validDays < 0 ? "late" : "muted"}>
                {validDays < 0 ? `expired ${-validDays} days ago` : validDays === 0 ? "expires today" : `${validDays} days left`}
              </span>
            )}
          </div>
          <div className="ws-tile">
            <span className="k">Stage</span>
            <b>
              {won ? "Won" : q.status === "lost" ? "Not proceeding" : q.status === "sent" ? "With the customer" : priced ? "Ready to send" : "To price"}
            </b>
            <span className="muted">
              {q.sent_at ? `sent ${formatDate(q.sent_at)}` : `created ${formatDate(q.created_at)}`}
              {q.revision_no ? ` · rev ${q.revision_no}` : ""}
            </span>
          </div>
          <button className="ws-tile" onClick={() => setTab("tasks")}>
            <span className="k">Open tasks</span>
            <b>{openTasks.length}</b>
            <span className="muted">{tasks.length - openTasks.length} done</span>
          </button>
        </div>
      </div>

      <nav className="ws-tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>
            {TAB_LABEL[x]}
            {x === "tasks" && openTasks.length > 0 && <span className="ws-count">{openTasks.length}</span>}
          </button>
        ))}
      </nav>

      <div className="ws-body">
        {tab === "overview" && (
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
              <h3>Key facts</h3>
              {[
                ["Customer", party],
                ["Shipper", q.supplier?.company ?? "—"],
                ["Commodity", q.commodity || "—"],
                ["Incoterms", q.incoterms || "—"],
                ["Customer ref", q.customer_reference || "—"],
                ["ETD", formatDate(q.etd)],
                ["ETA", formatDate(q.eta)],
              ].map(([k, v]) => (
                <div key={k} className="jv-field">
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
              <button className="link-btn" onClick={() => setTab("charges")}>
                All details &amp; charges →
              </button>
            </div>
            {(q.request_notes || q.enquiry_notes || q.request_pickup || q.request_delivery) && (
              <div className="ws-wide panel ws-panel">
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>The request</h3>
                {q.request_pickup && (
                  <div className="jv-field">
                    <span className="k">Collect from</span>
                    <span className="v">{q.request_pickup}</span>
                  </div>
                )}
                {q.request_delivery && (
                  <div className="jv-field">
                    <span className="k">Deliver to</span>
                    <span className="v">{q.request_delivery}</span>
                  </div>
                )}
                {(q.request_notes || q.enquiry_notes) && (
                  <p className="muted" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                    {q.request_notes || q.enquiry_notes}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {tab === "charges" && (
          <div className="panel ws-panel">
            <QuoteDetailBody q={q} />
          </div>
        )}
        {tab === "tasks" && (
          <RecordTasks
            tasks={tasks}
            defaults={{ quote_id: q.id, client_id: q.client_id, title: "" }}
            empty="No tasks for this quotation."
          />
        )}
        {tab === "shipment" && job && <QuoteShipment job={job} />}
      </div>

      <QuoteCommsRail quote={q} open={railOpen} onToggle={() => setRailOpen((v) => !v)} />
    </>
  );
}

/** The shipment this quote became: status, dates and progress. */
function QuoteShipment({ job }: { job: Job }) {
  const stepsQ = useJobTimeline(job.id);
  const steps = (stepsQ.data ?? []).filter((s) => !s.skipped && (s.step !== "Detained" || s.done));
  return (
    <div className="panel ws-panel">
      <div className="ws-sec-head">
        <h3>
          Shipment {job.reference} · {statusLabel(job.shipment_status, job.mode) || job.milestone}
        </h3>
        <Link className="btn small" to={`/jobs/${job.id}`}>
          Open shipment →
        </Link>
      </div>
      <div className="ws-facts">
        <div>
          <span className="k">ETD</span>
          <b>{formatDate(job.etd)}</b>
        </div>
        <div>
          <span className="k">ETA</span>
          <b>{formatDate(job.eta)}</b>
        </div>
        <div>
          <span className="k">PDD</span>
          <b>{formatDate(job.provisional_delivery_date)}</b>
        </div>
      </div>
      <TimelineProgress steps={steps} mode={job.mode} delivered={job.shipment_status === "Delivered"} />
    </div>
  );
}
