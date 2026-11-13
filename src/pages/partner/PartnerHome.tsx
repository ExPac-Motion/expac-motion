/**
 * Partner Portal (0244): the partner's own view of their ExPac work.
 *   PartnerDashboard  counts, a live map of their shipments, what needs
 *                     their attention, what's arriving next
 *   PartnerTracking   every active shipment on one map + a tracking grid
 *   PartnerQuotes     the Requests for Quote ExPac sent them (0241), status,
 *                     reply link and the rates they sent
 * Shipment data comes from partner_shipments() (their leg only).
 */
import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import FleetMap, { type FleetPoint } from "../../components/FleetMap";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { formatDate, formatDateTime, portCode } from "../../lib/format";
import { stepLabel } from "../../lib/steps";
import { shipmentStatusSlug, type PartnerKind } from "../../lib/types";
import { PortalIcon } from "../portal/PortalLayout";
import {
  partnerRfqStatus,
  usePartnerRfqs,
  usePartnerShipments,
  type PartnerRfq,
  type PartnerShipmentRow,
} from "../../lib/partnerShipments";

const d = (v: string | null | undefined) => (v ? formatDate(v) : "-");
const daysUntil = (iso: string | null | undefined) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);
const DEPARTED = new Set(["Loaded", "Departed", "In Transit", "Clearance Started", "Arrived", "Unloaded", "Customs", "Detained", "Released", "On-Delivery"]);

function StatusPill({ status, mode }: { status: string | null; mode: string | null }) {
  return <span className={`job-status job-status-ro is-${shipmentStatusSlug(status)}`}>{status ? stepLabel(status, mode) : "Created"}</span>;
}

/** Where each active shipment is: the live vessel / flight position, else
 *  its port of loading (before departure) or discharge (after). */
export function fleetPoints(rows: PartnerShipmentRow[]): FleetPoint[] {
  const out: FleetPoint[] = [];
  for (const r of rows) {
    if (r.completed) continue;
    const t = r.tracking;
    const lines = [
      r.vessel_name ? r.vessel_name : null,
      r.shipment_status ? stepLabel(r.shipment_status, r.mode) : null,
      `${portCode(r.origin)} to ${portCode(r.destination)}`,
      r.eta ? `ETA ${formatDate(r.eta)}` : null,
      t?.position_at ? `Last update ${formatDateTime(t.position_at)}` : null,
    ].filter((x): x is string => !!x);
    const air = /^(air|courier)/i.test(r.mode ?? "");
    if (t?.vessel_lat != null && t.vessel_lon != null) {
      out.push({ id: r.id, label: r.reference, lines, lat: t.vessel_lat, lon: t.vessel_lon, kind: "live", air });
    } else {
      const after = DEPARTED.has(r.shipment_status ?? "");
      const lat = after ? (t?.pod_lat ?? t?.pol_lat) : (t?.pol_lat ?? t?.pod_lat);
      const lon = after ? (t?.pod_lon ?? t?.pol_lon) : (t?.pol_lon ?? t?.pod_lon);
      if (lat != null && lon != null) out.push({ id: r.id, label: r.reference, lines, lat, lon, kind: "port", air });
    }
  }
  return out;
}

/* ---------------- Dashboard ---------------- */

function Kpi({ label, value, icon, onClick, tone }: { label: string; value: number; icon: string; onClick: () => void; tone?: "amber" }) {
  return (
    <button type="button" className={`pt-kpi${tone ? ` ${tone}` : ""}`} onClick={onClick}>
      <span className="pt-kpi-label">{label}</span>
      <span className="pt-kpi-icon" aria-hidden>
        <PortalIcon name={icon} />
      </span>
      <span className="pt-kpi-value">{value}</span>
    </button>
  );
}

export function PartnerDashboard({
  kind,
  onOpen,
  onTab,
  demoRows,
  demoRfqs,
}: {
  kind: PartnerKind;
  onOpen: (id: string) => void;
  onTab: (t: "shipments" | "tracking" | "quotes") => void;
  demoRows?: PartnerShipmentRow[];
  demoRfqs?: PartnerRfq[];
}) {
  const sq = usePartnerShipments(!demoRows);
  const rq = usePartnerRfqs(!demoRfqs);
  const rows = useMemo(() => demoRows ?? sq.data ?? [], [demoRows, sq.data]);
  const rfqs = useMemo(() => demoRfqs ?? rq.data ?? [], [demoRfqs, rq.data]);
  const active = rows.filter((r) => !r.completed);
  const soon = active.filter((r) => {
    const n = daysUntil(r.eta);
    return n !== null && n <= 5;
  });
  const todo = active.filter((r) => r.action || r.unread > 0);
  const waiting = rfqs.filter((r) => r.status === "awaiting");
  const unread = active.reduce((n, r) => n + r.unread, 0);
  const points = useMemo(() => fleetPoints(rows), [rows]);
  const next = [...active].filter((r) => r.eta).sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? "")).slice(0, 6);

  if (!demoRows && sq.isLoading) return <Loading />;
  if (!demoRows && sq.error) return <ErrorNote error={sq.error} />;

  return (
    <>
      <PageHeader eyebrow="Partner Portal" title="Dashboard" />
      <div className="pt-kpis">
        <Kpi label="Active shipments" value={active.length} icon="shipments" onClick={() => onTab("shipments")} />
        <Kpi label="Arriving in 5 days" value={soon.length} icon="calendar" onClick={() => onTab("shipments")} />
        <Kpi label="Need your action" value={todo.length} icon="tasks" onClick={() => onTab("shipments")} tone={todo.length ? "amber" : undefined} />
        <Kpi label="Waiting for your rates" value={waiting.length} icon="quotes" onClick={() => onTab("quotes")} tone={waiting.length ? "amber" : undefined} />
        <Kpi label="New messages from ExPac" value={unread} icon="party" onClick={() => onTab("shipments")} />
      </div>

      <div className="ph-grid">
        <div className="panel">
          <div className="ph-head">
            <h3>Where your shipments are</h3>
            <button type="button" className="link-btn" onClick={() => onTab("tracking")}>
              Open tracking
            </button>
          </div>
          <FleetMap points={points} height={320} onOpen={onOpen} />
        </div>

        <div className="panel">
          <div className="ph-head">
            <h3>Needs your attention</h3>
          </div>
          {todo.length === 0 && waiting.length === 0 ? (
            <EmptyState>Nothing waiting on you. Nice.</EmptyState>
          ) : (
            <ul className="ph-todo">
              {waiting.map((r) => (
                <li key={r.id}>
                  <div>
                    <b>{r.rfq_number}</b>
                    <span className="hint">
                      {portCode(r.origin)} to {portCode(r.destination)} · reply by {d(r.reply_by)}
                    </span>
                  </div>
                  <a className="btn small" href={`/rfq/reply/${r.token}`} target="_blank" rel="noopener">
                    Send rates
                  </a>
                </li>
              ))}
              {todo.map((r) => (
                <li key={r.id}>
                  <div>
                    <b>{r.reference}</b>
                    <span className="hint">
                      {[r.action, r.unread ? `${r.unread} new message${r.unread === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <button type="button" className="btn small outline" onClick={() => onOpen(r.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="ph-head">
          <h3>Arriving next</h3>
          <button type="button" className="link-btn" onClick={() => onTab("shipments")}>
            All shipments
          </button>
        </div>
        {next.length === 0 ? (
          <EmptyState>No arrivals scheduled.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="customs-table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th>Mode</th>
                  <th>POL</th>
                  <th>POD</th>
                  {kind !== "transporter" && <th>Vessel / Flight</th>}
                  <th>ETA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {next.map((r) => {
                  const n = daysUntil(r.eta);
                  return (
                    <tr key={r.id} className="customs-row" onClick={() => onOpen(r.id)}>
                      <td>
                        <button type="button" className="ref-link">
                          {r.reference}
                        </button>
                      </td>
                      <td>{r.mode || "-"}</td>
                      <td>{portCode(r.origin)}</td>
                      <td>{portCode(r.destination)}</td>
                      {kind !== "transporter" && <td>{r.vessel_name || "-"}</td>}
                      <td>
                        <span className={n !== null && n <= 5 ? "job-eta is-due" : undefined}>{d(r.eta)}</span>
                      </td>
                      <td>
                        <StatusPill status={r.shipment_status} mode={r.mode} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- Tracking ---------------- */

export function PartnerTracking({
  kind,
  onOpen,
  demoRows,
}: {
  kind: PartnerKind;
  onOpen: (id: string) => void;
  demoRows?: PartnerShipmentRow[];
}) {
  const q = usePartnerShipments(!demoRows);
  const [search, setSearch] = useState("");
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const all = useMemo(() => (demoRows ?? q.data ?? []).filter((r) => !r.completed), [demoRows, q.data]);
  const needle = search.trim().toLowerCase();
  const rows = all.filter(
    (r) => !needle || [r.reference, r.vessel_name, r.awb_mbl, r.container_no].some((v) => v?.toLowerCase().includes(needle)),
  );
  const points = useMemo(() => fleetPoints(rows), [rows]);
  const columns: DataColumn<PartnerShipmentRow>[] = [
    {
      key: "shipment",
      header: "Shipment",
      width: 130,
      render: (r) => (
        <button type="button" className="ref-link" onClick={() => onOpen(r.id)}>
          {r.reference}
        </button>
      ),
      sortValue: (r) => r.reference,
    },
    { key: "mode", header: "Mode", width: 140, render: (r) => r.mode || "-", sortValue: (r) => r.mode ?? "" },
    { key: "status", header: "Status", width: 150, render: (r) => <StatusPill status={r.shipment_status} mode={r.mode} />, sortValue: (r) => r.shipment_status ?? "" },
    ...(kind === "transporter"
      ? []
      : ([{ key: "vessel", header: "Vessel / Flight", width: 180, render: (r) => r.vessel_name || "-", sortValue: (r) => r.vessel_name ?? "" }] as DataColumn<PartnerShipmentRow>[])),
    { key: "pol", header: "POL", width: 90, render: (r) => portCode(r.origin), sortValue: (r) => portCode(r.origin) },
    { key: "pod", header: "POD", width: 90, render: (r) => portCode(r.destination), sortValue: (r) => portCode(r.destination) },
    { key: "etd", header: "ETD", width: 110, render: (r) => d(r.etd), sortValue: (r) => r.etd ?? "" },
    {
      key: "eta",
      header: "ETA",
      width: 120,
      render: (r) => {
        const n = daysUntil(r.eta);
        return <span className={n !== null && n <= 5 ? "job-eta is-due" : undefined}>{d(r.eta)}</span>;
      },
      sortValue: (r) => r.eta ?? "",
    },
    {
      key: "position",
      header: "Position",
      width: 120,
      render: (r) => (r.tracking?.vessel_lat != null ? <span className="ph-live">Live</span> : r.tracking ? "Estimated" : "Not tracking yet"),
      sortValue: (r) => (r.tracking?.vessel_lat != null ? 0 : r.tracking ? 1 : 2),
    },
    {
      key: "updated",
      header: "Last Update",
      width: 150,
      render: (r) => (r.tracking?.position_at ? formatDateTime(r.tracking.position_at) : "-"),
      sortValue: (r) => r.tracking?.position_at ?? "",
    },
  ];

  if (!demoRows && q.isLoading) return <Loading />;
  if (!demoRows && q.error) return <ErrorNote error={q.error} />;
  return (
    <>
      <PageHeader eyebrow="Your active shipments" title="Live Tracking" />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search shipment, vessel, MBL / AWB, container…" />}
        count={`${rows.length} shipment${rows.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        <FleetMap points={points} height={420} onOpen={onOpen} />
        <p className="hint" style={{ margin: "8px 0 0" }}>
          <span className="ph-dot live" /> live position <span className="ph-dot port" /> port (no live position yet)
        </p>
      </div>
      <div className="panel jobs-panel" style={{ marginTop: 14 }}>
        {rows.length === 0 ? (
          <EmptyState>No active shipments.</EmptyState>
        ) : (
          <DataTable
            tableKey="partner-tracking"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => onOpen(r.id)}
          />
        )}
      </div>
    </>
  );
}

/* ---------------- Quotes (RFQs) ---------------- */

export function PartnerQuotes({ demoRfqs }: { demoRfqs?: PartnerRfq[] }) {
  const q = usePartnerRfqs(!demoRfqs);
  const [view, setView] = useState<"open" | "all">("open");
  const [search, setSearch] = useState("");
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [show, setShow] = useState<PartnerRfq | null>(null);
  const all = useMemo(() => demoRfqs ?? q.data ?? [], [demoRfqs, q.data]);
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((r) => view === "all" || r.status === "awaiting" || r.status === "received")
    .filter((r) => !needle || [r.rfq_number, r.origin, r.destination, r.mode].some((v) => v?.toLowerCase().includes(needle)));
  const canReply = (r: PartnerRfq) => r.status === "awaiting" || r.status === "received";

  const columns: DataColumn<PartnerRfq>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 130,
      render: (r) =>
        canReply(r) ? (
          <a
            className="btn small"
            href={`/rfq/reply/${r.token}`}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {r.status === "awaiting" ? "Send rates" : "Edit my rates"}
          </a>
        ) : (
          <span className="hint">Closed</span>
        ),
    },
    { key: "rfq", header: "RFQ No", width: 150, render: (r) => <b>{r.rfq_number}</b>, sortValue: (r) => r.rfq_number },
    { key: "mode", header: "Mode", width: 140, render: (r) => r.mode || "-", sortValue: (r) => r.mode ?? "" },
    { key: "pol", header: "Origin", width: 180, render: (r) => r.origin || "-", sortValue: (r) => r.origin ?? "" },
    { key: "pod", header: "Destination", width: 180, render: (r) => r.destination || "-", sortValue: (r) => r.destination ?? "" },
    { key: "inco", header: "Incoterm", width: 90, render: (r) => r.incoterms || "-" },
    { key: "sent", header: "Received", width: 110, render: (r) => d(r.sent_at), sortValue: (r) => r.sent_at },
    {
      key: "reply",
      header: "Reply By",
      width: 110,
      render: (r) => {
        const late = r.status === "awaiting" && !!r.reply_by && r.reply_by < new Date().toISOString().slice(0, 10);
        return <span className={late ? "job-eta is-due" : undefined}>{d(r.reply_by)}</span>;
      },
      sortValue: (r) => r.reply_by ?? "",
    },
    {
      key: "status",
      header: "Status",
      width: 190,
      render: (r) => {
        const s = partnerRfqStatus(r);
        return <span className={`ph-rfq ${s.tone}`}>{s.label}</span>;
      },
      sortValue: (r) => r.status,
    },
    { key: "replied", header: "You Replied", width: 130, render: (r) => (r.responded_at ? formatDate(r.responded_at) : "-"), sortValue: (r) => r.responded_at ?? "" },
    { key: "rates", header: "Rates Sent", width: 100, render: (r) => (r.rates.length ? `${r.rates.length} charge${r.rates.length === 1 ? "" : "s"}` : "-") },
  ];

  if (!demoRfqs && q.isLoading) return <Loading />;
  if (!demoRfqs && q.error) return <ErrorNote error={q.error} />;
  return (
    <>
      <PageHeader eyebrow="Requests for Quote from ExPac" title="Quotes" />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search RFQ, origin, destination…" />}
        filters={
          <div className="wms-seg">
            <button type="button" className={view === "open" ? "active" : ""} onClick={() => setView("open")}>
              Open
            </button>
            <button type="button" className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
              All (120 days)
            </button>
          </div>
        }
        count={`${rows.length} request${rows.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      />
      <div className="panel jobs-panel">
        {rows.length === 0 ? (
          <EmptyState>{view === "open" ? "No open requests. New requests from ExPac appear here." : "No requests in the last 120 days."}</EmptyState>
        ) : (
          <DataTable
            tableKey={`partner-rfqs-${view}`}
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setShow(r)}
          />
        )}
      </div>
      {show && (
        <Modal title={`${show.rfq_number}, your rates`} onClose={() => setShow(null)}>
          <p className="hint" style={{ marginTop: 0 }}>
            {show.origin || "-"} to {show.destination || "-"} · {show.mode || "-"} · {partnerRfqStatus(show).label}
          </p>
          {show.rates.length === 0 ? (
            <EmptyState>You haven't sent rates for this request.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="customs-table">
                <thead>
                  <tr>
                    <th>Charge</th>
                    <th>Unit</th>
                    <th>Cur</th>
                    <th className="num">Rate</th>
                    <th className="num">Min</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {show.rates.map((x, i) => (
                    <tr key={i}>
                      <td>
                        {x.description}
                        {x.code && <div className="hint">{x.code}</div>}
                      </td>
                      <td>{x.unit || "-"}</td>
                      <td>{x.cur}</td>
                      <td className="num">{x.rate ?? "-"}</td>
                      <td className="num">{x.min_charge ?? "-"}</td>
                      <td>{x.remarks || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            {[show.validity && `Valid: ${show.validity}`, show.transit_time && `Transit: ${show.transit_time}`, show.remarks]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="ps-actions">
            {canReply(show) && (
              <a className="btn" href={`/rfq/reply/${show.token}`} target="_blank" rel="noopener">
                {show.status === "awaiting" ? "Send rates" : "Edit my rates"}
              </a>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
