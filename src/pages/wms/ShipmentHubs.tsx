// Shipments <-> Motion WMS sync (0213): the shipment's Hubs card and the
// WMS Dashboard's sync check.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../components/Toast";
import { useCan } from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import { useWmsWarehouses } from "../../lib/wms";
import {
  HUB_RULES,
  HUB_STATE,
  hubDb,
  isHubProblem,
  useHubMutation,
  useHubSync,
  useJobHubs,
  useJobsWithoutHub,
  type HubRole,
  type HubSyncRow,
} from "../../lib/wmsSync";
import type { Job } from "../../lib/types";

const ROLE_LABEL: Record<HubRole, string> = { origin: "Origin", transit: "Transit", destination: "Destination" };
const ROLE_ORDER: Record<HubRole, number> = { origin: 0, transit: 1, destination: 2 };

function stateText(h: HubSyncRow): string {
  if (h.state === "pieces_differ") return `${HUB_STATE.pieces_differ.label} (${h.receipt_pieces} vs ${h.quote_pieces})`;
  if (h.state === "kg_differ") return `${HUB_STATE.kg_differ.label} (${h.receipt_kg} vs ${h.quote_kg} kg)`;
  if (h.state === "waiting") {
    const rule = HUB_RULES[h.role];
    return rule ? `Books in at ${rule.inAt}` : "Book in by hand";
  }
  return HUB_STATE[h.state].label;
}

export function HubStateBadge({ h }: { h: HubSyncRow }) {
  return <span className={`badge ${HUB_STATE[h.state].tone}`}>{stateText(h)}</span>;
}

/** Where the goods are on the way: one line per hub, picked automatically
 *  from origin / destination, booked in and released from the shipment
 *  status (transit hubs by hand). */
export function HubsSection({ job }: { job: Job }) {
  const can = useCan();
  const hubsQ = useJobHubs(job.id);
  const whQ = useWmsWarehouses();
  const { toast, error } = useToast();
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState<HubRole>("origin");
  const add = useHubMutation(hubDb.add);
  const setRole = useHubMutation(hubDb.setRole);
  const remove = useHubMutation(hubDb.remove);
  const receive = useHubMutation(hubDb.receive);
  const release = useHubMutation(hubDb.release);
  const hubs = useMemo(
    () => [...(hubsQ.data ?? [])].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.position - b.position),
    [hubsQ.data],
  );
  const free = (whQ.data ?? []).filter((w) => w.active && !hubs.some((h) => h.warehouse_id === w.id));
  const busy = add.isPending || setRole.isPending || remove.isPending || receive.isPending || release.isPending;
  if (!can("warehouse")) return null;

  const run = <V,>(m: { mutateAsync: (v: V) => Promise<unknown> }, v: V, ok: string) =>
    m.mutateAsync(v).then(
      () => toast(ok),
      (e: unknown) => error(e instanceof Error ? e.message : "Could not save"),
    );

  return (
    <div className="job-hubs">
      <div className="job-hubs-head">
        <span className="k">Hubs (Motion WMS)</span>
        <span className="hint">
          {hubs.length === 0
            ? "No hub matches this shipment's origin or destination. Add one if the goods pass through a warehouse."
            : "Booked in and released automatically as the status moves on; a receipt or release in WMS moves the status on."}
        </span>
      </div>
      {hubs.map((h) => {
        const rule = HUB_RULES[h.role];
        return (
          <div key={h.hub_id} className="job-hub-row">
            <select
              className="job-hub-role"
              value={h.role}
              disabled={busy}
              aria-label={`Role of ${h.warehouse_code}`}
              onChange={(e) => run(setRole, { hubId: h.hub_id, role: e.target.value as HubRole }, "Hub updated")}
            >
              {(Object.keys(ROLE_LABEL) as HubRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <div className="job-hub-main">
              <strong>
                {h.warehouse_code} · {h.warehouse_name}
                {h.auto && <span className="hint"> (matched automatically)</span>}
              </strong>
              <span className="hint">{rule ? `In at ${rule.inAt}, out at ${rule.outAt}` : "Book in and out by hand"}</span>
              <span className="job-hub-facts">
                {h.receipt_id ? (
                  <>
                    <Link to={`/wms/receipts/${h.receipt_id}`}>{h.receipt_no}</Link> received {formatDate(h.received_at)}
                    {" · "}
                    {h.on_hand > 0 ? `${h.on_hand} pcs on hand` : h.released_at ? `released ${formatDate(h.released_at)}` : "nothing on hand"}
                  </>
                ) : (
                  "Not booked in yet"
                )}
              </span>
            </div>
            <HubStateBadge h={h} />
            <div className="job-hub-actions">
              {!h.receipt_id && (
                <button type="button" className="btn outline btn-sm" disabled={busy} onClick={() => run(receive, h.hub_id, `Booked in at ${h.warehouse_code}`)}>
                  Received
                </button>
              )}
              {h.receipt_id && h.on_hand > 0 && (
                <button type="button" className="btn outline btn-sm" disabled={busy} onClick={() => run(release, h.hub_id, `Released from ${h.warehouse_code}`)}>
                  Released
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Remove hub (its receipt stays in Motion WMS)"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${h.warehouse_code} from this shipment? Its receipt stays in Motion WMS.`)) run(remove, h.hub_id, "Hub removed");
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {free.length > 0 && (
        <div className="job-hub-add">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Warehouse / hub">
            <option value="">Add a hub…</option>
            {free.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
          <select value={pickRole} onChange={(e) => setPickRole(e.target.value as HubRole)} aria-label="Hub role">
            {(Object.keys(ROLE_LABEL) as HubRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn outline btn-sm"
            disabled={!pick || busy}
            onClick={() => run(add, { jobId: job.id, warehouseId: pick, role: pickRole }, "Hub added").then(() => setPick(""))}
          >
            Add hub
          </button>
        </div>
      )}
    </div>
  );
}

/** WMS Dashboard: are shipments and the warehouse in step? */
export function WmsSyncPanel() {
  const q = useHubSync();
  const noHubQ = useJobsWithoutHub();
  const rows = q.data ?? [];
  const noHub = noHubQ.data ?? [];
  const problems = useMemo(() => rows.filter((r) => isHubProblem(r.state)), [rows]);
  const inSync = rows.filter((r) => r.state === "in_sync").length;
  const toCheck = problems.length + noHub.length;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Shipments ↔ WMS sync</h2>
        <span className="hint">
          {rows.length === 0 && noHub.length === 0
            ? "No shipment hubs yet"
            : `${inSync} of ${rows.length} hub${rows.length === 1 ? "" : "s"} in sync · ${toCheck} to check`}
        </span>
      </div>
      {q.isLoading || noHubQ.isLoading ? (
        <p className="hint">Loading…</p>
      ) : toCheck === 0 ? (
        <p className="hint">
          {rows.length === 0
            ? "New shipments get their hubs from their origin / destination (WMS › Settings › hub match codes)."
            : "Everything matches: every hub that should hold goods has them, and nothing is left behind."}
        </p>
      ) : (
        <table className="table--compact wms-mini">
          <tbody>
            {problems.map((h) => (
              <tr key={h.hub_id}>
                <td>
                  <Link to={`/jobs/${h.job_id}`}>{h.job_ref}</Link>
                </td>
                <td>{h.shipment_status || "—"}</td>
                <td>{h.warehouse_code}</td>
                <td>{h.receipt_id ? <Link to={`/wms/receipts/${h.receipt_id}`}>{h.receipt_no}</Link> : "—"}</td>
                <td>
                  <HubStateBadge h={h} />
                </td>
              </tr>
            ))}
            {noHub.map((j) => (
              <tr key={j.job_id}>
                <td>
                  <Link to={`/jobs/${j.job_id}`}>{j.job_ref}</Link>
                </td>
                <td>{j.shipment_status || "—"}</td>
                <td colSpan={2}>
                  {j.origin || "—"} → {j.destination || "—"}
                </td>
                <td>
                  <span className="badge open">No hub</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
