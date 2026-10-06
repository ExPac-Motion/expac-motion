import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { formatDate, formatDateTime, money } from "../../lib/format";
import {
  CONDITION_LABEL,
  daysBetween,
  qty,
  useWmsBillingRuns,
  useWmsMoves,
  useWmsReceipts,
  useWmsReleases,
  useWmsWarehouses,
  type WmsBillingRun,
  type WmsReceipt,
  type WmsRelease,
} from "../../lib/wms";
import { PackagesTable } from "../wms/WmsReceipts";
import { ReceiptStatusBadge } from "../wms/shared";
import ReceiptImages from "../wms/ReceiptImages";
import PortalReleaseRequests from "./PortalReleaseRequests";
import PortalPreadvices from "./PortalPreadvices";
import { PortalExceptions, PortalServices } from "./PortalWmsExtras";
import PortalWmsOverview, { JourneySteps, useWmsJourney } from "./PortalWmsOverview";
import { WMS_STAGE_LABEL, wmsStage } from "../../lib/portal";

type View = "overview" | "stock" | "all" | "preadvice" | "releases" | "requests" | "services" | "exceptions" | "statements";

/** Customer Portal > Warehouse (0138): the customer's own goods in the
 *  ExPac warehouse, releases and storage statements, read only. */
export default function PortalWarehousePage() {
  const navigate = useNavigate();
  const receiptsQ = useWmsReceipts();
  const releasesQ = useWmsReleases();
  const runsQ = useWmsBillingRuns();
  const whQ = useWmsWarehouses();
  // The sidebar's Warehouse › Receipt / Release / Inventory / Storage statements set ?view=.
  const [params, setParams] = useSearchParams();
  const asked = params.get("view") as View | null;
  const view: View = asked && ["overview", "stock", "all", "preadvice", "releases", "requests", "services", "exceptions", "statements"].includes(asked) ? asked : "overview";
  const setView = (v: View) => setParams({ view: v }, { replace: true });
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<WmsReceipt | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const whName = (id: string | null) => whQ.data?.find((w) => w.id === id)?.name ?? "ExPac warehouse";
  const receipts = receiptsQ.data ?? [];
  const recById = new Map(receipts.map((r) => [r.id, r]));
  const inStock = receipts.filter((r) => r.on_hand > 0);
  const q = search.trim().toLowerCase();
  const match = (r: WmsReceipt) =>
    !q ||
    [r.receipt_no, r.description, r.marks, r.customer_reference, r.inbound_ref, ...r.packages.map((p) => `${p.sku ?? ""} ${p.description ?? ""}`)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  const receiptRows = (view === "stock" ? inStock : receipts).filter(match);
  const releases = (releasesQ.data ?? []).filter(
    (r) => !q || [r.release_no, r.outbound_ref, ...r.lines.map((l) => recById.get(l.receipt_id)?.receipt_no)].join(" ").toLowerCase().includes(q),
  );
  const runs = (runsQ.data ?? []).filter((r) => !q || [r.run_no, r.invoice_no].join(" ").toLowerCase().includes(q));

  const receiptCols: DataColumn<WmsReceipt>[] = [
    { key: "no", header: "Receipt No", width: 110, render: (r) => <b>{r.receipt_no}</b>, sortValue: (r) => r.receipt_no },
    { key: "date", header: "Received", width: 100, render: (r) => formatDate(r.received_at), sortValue: (r) => r.received_at },
    { key: "wh", header: "Warehouse", width: 170, render: (r) => whName(r.warehouse_id) },
    { key: "desc", header: "Description", width: 220, render: (r) => r.description || "—" },
    { key: "ref", header: "Your reference", width: 130, render: (r) => r.customer_reference || "—" },
    { key: "pcs", header: "Received", width: 80, render: (r) => `${r.pieces} pcs` },
    { key: "onhand", header: "In Motion Warehouse", width: 150, render: (r) => `${r.on_hand} pcs`, sortValue: (r) => r.on_hand },
    { key: "kg", header: "Kg", width: 80, render: (r) => qty(r.on_hand_kg), sortValue: (r) => r.on_hand_kg },
    { key: "cbm", header: "CBM", width: 80, render: (r) => qty(r.on_hand_cbm, 3), sortValue: (r) => r.on_hand_cbm },
    {
      key: "days",
      header: "Days in store",
      width: 100,
      render: (r) => (r.on_hand > 0 ? daysBetween(r.received_at, new Date()) : "—"),
      sortValue: (r) => daysBetween(r.received_at, new Date()),
    },
    { key: "cond", header: "Condition", width: 120, render: (r) => CONDITION_LABEL[r.condition] },
    { key: "status", header: "Status", width: 120, render: (r) => <ReceiptStatusBadge status={r.status} /> },
  ];
  const sum = (r: WmsRelease, k: "pieces" | "gross_kg" | "volume_cbm") => r.lines.reduce((s, l) => s + l[k], 0);
  const releaseCols: DataColumn<WmsRelease>[] = [
    { key: "no", header: "Release No", width: 110, render: (r) => <b>{r.release_no}</b>, sortValue: (r) => r.release_no },
    { key: "date", header: "Released", width: 100, render: (r) => formatDate(r.released_at), sortValue: (r) => r.released_at },
    { key: "rec", header: "Receipts", width: 180, render: (r) => [...new Set(r.lines.map((l) => recById.get(l.receipt_id)?.receipt_no))].join(", ") },
    { key: "pcs", header: "Pieces", width: 80, render: (r) => sum(r, "pieces") },
    { key: "kg", header: "Kg", width: 80, render: (r) => qty(sum(r, "gross_kg")) },
    { key: "cbm", header: "CBM", width: 80, render: (r) => qty(sum(r, "volume_cbm"), 3) },
    { key: "coll", header: "Collected by", width: 160, render: (r) => r.collected_by || "—" },
    { key: "out", header: "Reference", width: 130, render: (r) => r.outbound_ref || "—" },
  ];
  const runCols: DataColumn<WmsBillingRun>[] = [
    { key: "no", header: "Statement No", width: 120, render: (r) => <b>{r.run_no}</b>, sortValue: (r) => r.run_no },
    { key: "period", header: "Period", width: 200, render: (r) => `${formatDate(r.period_from)} – ${formatDate(r.period_to)}`, sortValue: (r) => r.period_from },
    { key: "total", header: "Total (incl. VAT)", width: 140, render: (r) => money(r.total), sortValue: (r) => r.total },
    { key: "inv", header: "Invoice No", width: 130, render: (r) => r.invoice_no || "—" },
  ];

  const loading = receiptsQ.isLoading || (view === "releases" && releasesQ.isLoading) || (view === "statements" && runsQ.isLoading);
  const err = receiptsQ.error ?? releasesQ.error ?? runsQ.error;
  const totals = inStock.reduce((t, r) => ({ pcs: t.pcs + r.on_hand, cbm: t.cbm + r.on_hand_cbm, kg: t.kg + r.on_hand_kg }), { pcs: 0, cbm: 0, kg: 0 });

  return (
    <>
      <PageHeader eyebrow="Warehouse" title={view === "overview" ? "Warehouse Overview" : view === "requests" ? "Release Requests" : view === "preadvice" ? "Pre-advise Goods" : view === "services" ? "Warehouse Services" : view === "exceptions" ? "Exceptions" : view === "releases" ? "Warehouse Release" : view === "statements" ? "Storage Statements" : view === "all" ? "Warehouse Receipt" : "Inventory"} />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search receipt, SKU, reference…" />}
        filters={
          <div className="wms-seg">
            {(
              [
                ["overview", "Overview"],
                ["stock", "In Motion Warehouse"],
                ["all", "All receipts"],
                ["preadvice", "Pre-advise"],
                ["services", "Services"],
                ["exceptions", "Exceptions"],
                ["releases", "Releases"],
                ["requests", "Release requests"],
                ["statements", "Storage statements"],
              ] as [View, string][]
            ).map(([v, label]) => (
              <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </div>
        }
        count={`${inStock.length} in Motion Warehouse · ${totals.pcs} pcs · ${qty(totals.cbm, 2)} CBM`}
        onToolsSlot={setToolsSlot}
      />
      {view === "overview" ? (
        <PortalWmsOverview receipts={receipts} loading={receiptsQ.isLoading} search={search} onOpen={setViewing} toolsSlot={toolsSlot} />
      ) : view === "requests" ? (
        <PortalReleaseRequests receipts={receipts} toolsSlot={toolsSlot} />
      ) : view === "preadvice" ? (
        <PortalPreadvices receipts={receipts} toolsSlot={toolsSlot} />
      ) : view === "services" ? (
        <PortalServices receipts={receipts} toolsSlot={toolsSlot} />
      ) : view === "exceptions" ? (
        <PortalExceptions receipts={receipts} toolsSlot={toolsSlot} />
      ) : (
      <div className="panel">
        {loading ? (
          <Loading />
        ) : err ? (
          <ErrorNote error={err} />
        ) : view === "releases" ? (
          releases.length === 0 ? (
            <EmptyState>No goods released yet.</EmptyState>
          ) : (
            <DataTable tableKey="portal-wms-releases" className="table--compact" toolsPortal={toolsSlot} columns={releaseCols} rows={releases} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/wms/print/release/${r.id}`)} />
          )
        ) : view === "statements" ? (
          runs.length === 0 ? (
            <EmptyState>No storage statements yet.</EmptyState>
          ) : (
            <DataTable tableKey="portal-wms-statements" className="table--compact" toolsPortal={toolsSlot} columns={runCols} rows={runs} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/wms/print/billing/${r.id}`)} />
          )
        ) : receiptRows.length === 0 ? (
          <EmptyState>{view === "stock" ? "Nothing of yours is in the warehouse right now." : "No receipts yet."}</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-wms-receipts"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={receiptCols}
            rows={receiptRows}
            rowKey={(r) => r.id}
            onRowClick={(r) => setViewing(r)}
          />
        )}
      </div>
      )}
      {viewing && <PortalReceiptModal receipt={viewing} warehouse={whName(viewing.warehouse_id)} onClose={() => setViewing(null)} />}
    </>
  );
}

function PortalReceiptModal({ receipt: r, warehouse, onClose }: { receipt: WmsReceipt; warehouse: string; onClose: () => void }) {
  const navigate = useNavigate();
  const movesQ = useWmsMoves();
  // Customers see goods in and out, not internal bay moves or count adjustments.
  const history = (movesQ.data ?? []).filter((m) => m.receipt_id === r.id && (m.kind === "receipt" || m.kind === "release"));
  const fields: [string, string][] = [
    ["Received", formatDateTime(r.received_at)],
    ["Warehouse", warehouse],
    ["Your reference", r.customer_reference || "—"],
    ["Inbound ref", r.inbound_ref || "—"],
    ["Description", r.description || "—"],
    ["Marks & numbers", r.marks || "—"],
    ["Pieces received / in Motion Warehouse", `${r.pieces} / ${r.on_hand}`],
    ["Pallets", String(r.pallets)],
    ["Gross kg", qty(r.gross_kg)],
    ["CBM", qty(r.volume_cbm, 3)],
    ["Condition", CONDITION_LABEL[r.condition] + (r.condition_notes ? `, ${r.condition_notes}` : "")],
    ["Days in store", r.on_hand > 0 ? String(daysBetween(r.received_at, new Date())) : "—"],
  ];
  return (
    <Modal
      title={r.receipt_no}
      onClose={onClose}
      wide
      headerActions={
        <>
          <ReceiptStatusBadge status={r.status} />
          <button className="btn outline btn-sm" onClick={() => navigate(`/wms/print/receipt/${r.id}`)}>
            Print receipt
          </button>
        </>
      }
    >
      <div className="wms-fields">
        {fields.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <PortalJourney receipt={r} />
      <h4 className="wms-subhead">Images</h4>
      <ReceiptImages receiptId={r.id} editable={false} />
      <h4 className="wms-subhead">Package items</h4>
      {r.packages.length === 0 ? <p className="hint">No package items listed.</p> : <PackagesTable packages={r.packages} />}
      <h4 className="wms-subhead">In &amp; out</h4>
      <table className="table--compact wms-mini">
        <thead>
          <tr>
            <th>Date</th>
            <th>What</th>
            <th>Pieces</th>
          </tr>
        </thead>
        <tbody>
          {history.map((m) => (
            <tr key={m.id}>
              <td>{formatDateTime(m.at)}</td>
              <td>{m.kind === "receipt" ? "Received" : "Released"}</td>
              <td>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/** The receipt's journey: stage dots + where / checked / consolidation / shipment. */
function PortalJourney({ receipt: r }: { receipt: WmsReceipt }) {
  const j = useWmsJourney();
  const t = j.tracker.get(r.id);
  const stage = wmsStage(r, t);
  const rows: [string, string][] = [
    ["Stage", WMS_STAGE_LABEL[stage]],
    ["Where", stage === "shipped" ? "Left the warehouse" : j.whereOf(r)],
    ["Checked", t?.checked_at ? formatDateTime(t.checked_at) : "Not yet"],
    ["Consolidation", t?.consol_no ? [t.consol_no, t.house_no ? "house " + t.house_no : null].filter(Boolean).join(", ") : "—"],
    ["Master (MAWB / MBL)", t?.master_no || "—"],
    ["Flight / Vessel", t?.transport || "—"],
    ["ETD", formatDate(t?.etd)],
    ["Shipment No", t?.shipment_ref || "—"],
    ["Shipped on", t?.released_at ? formatDateTime(t.released_at) : "—"],
  ];
  return (
    <>
      <h4 className="wms-subhead">Journey</h4>
      <JourneySteps stage={stage} />
      <div className="wms-fields" style={{ marginTop: 12 }}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
    </>
  );
}
