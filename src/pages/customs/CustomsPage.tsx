/**
 * Customs (0230), Phase 1: the clearance board.
 *
 * Every air / sea shipment that reaches In Transit gets a customs file
 * (opened by the database), assigned to its clearing agent. The board shows
 * where each file stands; the file popup holds the document checklist, the
 * handover to the agent (a timestamped clearing instruction with the
 * documents attached) and the quick milestone buttons.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { useToast } from "../../components/Toast";
import { Kpi } from "../wms/shared";
import { useClearingAgents, useCompanySettings, useCustomsFiles, useShipmentDocumentsForJobs, useUpdateCompanySettings } from "../../lib/hooks";
import { CUSTOMS_STAGES, WITH_AGENT, checklist, daysBetween, fmtDays, stageShort } from "../../lib/customs";
import { formatDate } from "../../lib/format";
import { shipmentStatusSlug, type CustomsFile, type CustomsStage, type ShipmentDocument } from "../../lib/types";
import CustomsFileModal from "./CustomsFileModal";

type View = "open" | "docs_pending" | "ready" | "with_agent" | "query" | "cleared";
const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "All open" },
  { key: "docs_pending", label: "Documents pending" },
  { key: "ready", label: "Ready to hand over" },
  { key: "with_agent", label: "With agent" },
  { key: "query", label: "Queries" },
  { key: "cleared", label: "Cleared" },
];

export default function CustomsPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "settings" ? "settings" : "board";
  return (
    <>
      <PageHeader eyebrow="Customs" title={tab === "settings" ? "Customs Settings" : "Clearance Board"} />
      {tab === "settings" ? <CustomsSettings /> : <ClearanceBoard />}
    </>
  );
}

function inView(f: CustomsFile, v: View): boolean {
  const open = !f.closed_at;
  switch (v) {
    case "open":
      return open && f.stage !== "cleared";
    case "docs_pending":
      return open && f.stage === "docs_pending";
    case "ready":
      return open && f.stage === "ready";
    case "with_agent":
      return open && WITH_AGENT.includes(f.stage);
    case "query":
      return open && f.stage === "query";
    case "cleared":
      return f.stage === "cleared";
  }
}

function ClearanceBoard() {
  const filesQ = useCustomsFiles();
  const agentsQ = useClearingAgents();
  const [view, setView] = useState<View>("open");
  const [agent, setAgent] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);

  // Documents of each shipment (and its master, for a house).
  const jobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of files) {
      if (f.closed_at) continue;
      ids.add(f.job_id);
      if (f.job?.master_job_id) ids.add(f.job.master_job_id);
    }
    return [...ids].sort();
  }, [files]);
  const docsQ = useShipmentDocumentsForJobs(jobIds);
  const docsFor = useMemo(() => {
    const all = docsQ.data ?? [];
    return (f: CustomsFile): ShipmentDocument[] =>
      all.filter((d) => d.job_id === f.job_id || (!!f.job?.master_job_id && d.job_id === f.job.master_job_id));
  }, [docsQ.data]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(VIEWS.map((v) => [v.key, 0])) as Record<View, number>;
    for (const f of files) for (const v of VIEWS) if (inView(f, v.key)) c[v.key]++;
    return c;
  }, [files]);

  // Handover -> cleared, files cleared in the last 60 days.
  const kpi = useMemo(() => {
    const done = files.filter((f) => f.stage === "cleared" && f.handed_over_at && f.cleared_at);
    const avg = done.length ? done.reduce((s, f) => s + (daysBetween(f.handed_over_at, f.cleared_at) ?? 0), 0) / done.length : null;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = files.filter((f) => f.cleared_at && new Date(f.cleared_at) >= monthStart).length;
    const overdue = files.filter((f) => !f.closed_at && WITH_AGENT.includes(f.stage) && (daysBetween(f.handed_over_at) ?? 0) > 3).length;
    return { avg, thisMonth, overdue };
  }, [files]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return files
      .filter((f) => inView(f, view))
      .filter((f) => !agent || (agent === "none" ? !f.clearing_agent_id : f.clearing_agent_id === agent))
      .filter((f) => {
        if (!s) return true;
        const j = f.job;
        return [j?.reference, j?.client?.company, j?.awb_mbl, j?.container_no, j?.po_no, f.agent?.company, f.entry_no]
          .some((v) => v?.toLowerCase().includes(s));
      })
      .sort((a, b) => (a.job?.eta ?? "9999").localeCompare(b.job?.eta ?? "9999"));
  }, [files, view, agent, search]);

  if (filesQ.isLoading) return <Loading />;
  if (filesQ.error) return <ErrorNote error={filesQ.error} />;
  const open = files.find((f) => f.id === openId) ?? null;

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Shipment, customer, AWB / B/L, container, entry no…" />}
        count={`${rows.length} file${rows.length === 1 ? "" : "s"}`}
        filters={
          <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Clearing agent">
            <option value="">All clearing agents</option>
            <option value="none">No agent assigned</option>
            {(agentsQ.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.company}
              </option>
            ))}
          </select>
        }
      />

      <div className="cards wms-cards customs-cards">
        <Kpi label="Open files" value={String(counts.open)} />
        <Kpi label="Documents pending" value={String(counts.docs_pending)} tone={counts.docs_pending ? "amber" : undefined} />
        <Kpi label="Ready to hand over" value={String(counts.ready)} tone={counts.ready ? "teal" : undefined} />
        <Kpi label="With agent" value={String(counts.with_agent)} sub={kpi.overdue ? `${kpi.overdue} over 3 days` : undefined} />
        <Kpi label="Queries" value={String(counts.query)} tone={counts.query ? "orange" : undefined} />
        <Kpi label="Cleared this month" value={String(kpi.thisMonth)} />
        <Kpi label="Handover to cleared" value={fmtDays(kpi.avg)} sub="average, last 60 days" />
      </div>

      <div className="customs-views" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`customs-view${view === v.key ? " on" : ""}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            <span className="customs-view-n">{counts[v.key]}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        {rows.length === 0 ? (
          <EmptyState>
            {view === "open"
              ? "No open customs files. A file opens here when an air or sea shipment is marked In Transit."
              : "Nothing here."}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="customs-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Customer</th>
                  <th>AWB / B/L</th>
                  <th>ETA</th>
                  <th>Status</th>
                  <th>Clearing agent</th>
                  <th>Documents</th>
                  <th>Customs</th>
                  <th>With agent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const list = checklist(f, docsFor(f));
                  const have = list.filter((i) => i.docs.length).length;
                  const withAgent = WITH_AGENT.includes(f.stage) || f.stage === "cleared" ? daysBetween(f.handed_over_at, f.cleared_at) : null;
                  return (
                    <tr key={f.id} className="customs-row" onClick={() => setOpenId(f.id)}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => setOpenId(f.id)}>
                          {f.job?.reference ?? "—"}
                        </button>
                        <div className="hint">{f.job?.mode?.replace(/ \(.*\)/, "") ?? ""}</div>
                      </td>
                      <td>{f.job?.client?.company ?? "—"}</td>
                      <td>
                        {f.job?.awb_mbl || "—"}
                        {f.job?.container_no && <div className="hint">{f.job.container_no}</div>}
                      </td>
                      <td>{f.job?.eta ? formatDate(f.job.eta) : "—"}</td>
                      <td>
                        <span className={`job-status job-status-ro is-${shipmentStatusSlug(f.job?.shipment_status)}`}>
                          {f.job?.shipment_status ?? "—"}
                        </span>
                      </td>
                      <td>{f.agent?.company ?? <span className="customs-warn">Not assigned</span>}</td>
                      <td>
                        {f.stage === "docs_pending" || f.stage === "ready" ? (
                          <span className={`customs-docs${have === list.length ? " ok" : ""}`} title={list.map((i) => `${i.docs.length ? "✓" : "✗"} ${i.label}`).join("\n")}>
                            {have}/{list.length}
                          </span>
                        ) : (
                          <span className="hint">{f.entry_no ? `Entry ${f.entry_no}` : "Sent"}</span>
                        )}
                      </td>
                      <td>
                        <CustomsStagePill stage={f.stage} />
                      </td>
                      <td className={withAgent != null && withAgent > 3 && f.stage !== "cleared" ? "customs-late" : undefined}>
                        {fmtDays(withAgent)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <CustomsFileModal file={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

export function CustomsStagePill({ stage }: { stage: CustomsStage }) {
  return <span className={`customs-stage is-${stage}`}>{stageShort(stage)}</span>;
}

function CustomsSettings() {
  const settingsQ = useCompanySettings();
  const agentsQ = useClearingAgents();
  const update = useUpdateCompanySettings();
  const { toast, error } = useToast();
  if (settingsQ.isLoading) return <Loading />;
  const current = settingsQ.data?.customs_default_agent_id ?? "";
  return (
    <div className="panel customs-settings">
      <h3>Default clearing agent</h3>
      <p className="hint">
        A new customs file goes to the shipment's own clearing agent. When the shipment has none, it goes to this one.
      </p>
      <select
        value={current}
        onChange={async (e) => {
          try {
            await update.mutateAsync({ customs_default_agent_id: e.target.value || null });
            toast("Default clearing agent saved");
          } catch (err) {
            error(err instanceof Error ? err.message : "Could not save");
          }
        }}
      >
        <option value="">None</option>
        {(agentsQ.data ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.company}
          </option>
        ))}
      </select>
      <h3>How files open and close</h3>
      <ul className="hint">
        <li>A file opens when an air or sea shipment is marked In Transit (or Arrived, Unloaded, Customs or Detained).</li>
        <li>A master cleared as one gets one file; a master cleared per house gets a file for each house.</li>
        <li>It's "Ready to hand over" once the required documents are in the shipment's Document Vault.</li>
        <li>It closes when the shipment is Released, On-Delivery or Delivered, or completed.</li>
      </ul>
      <p className="hint">Stages: {CUSTOMS_STAGES.map((s) => s.label).join(" → ")}.</p>
    </div>
  );
}
