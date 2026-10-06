import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, Loading } from "../../components/common";
import { useMyJobs } from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import {
  WMS_STAGE_LABEL,
  usePortalWmsTracker,
  wmsStage,
  type WmsStage,
  type WmsTrackerRow,
} from "../../lib/portal";
import {
  locationLabel,
  qty,
  accruedThisMonth,
  stockByLocation,
  useWmsLocations,
  useWmsMoves,
  useWmsWarehouses,
  type WmsReceipt,
} from "../../lib/wms";

const STEPS: { key: WmsStage; label: string }[] = [
  { key: "received", label: "Received" },
  { key: "checked", label: "Checked" },
  { key: "preparing", label: "Preparing to ship" },
  { key: "shipped", label: "Shipped" },
];
const ORDER: Record<WmsStage, number> = { received: 0, checked: 1, preparing: 2, part_shipped: 2, shipped: 3 };

/** Received → Checked → Preparing to ship → Shipped, as four dots. */
export function JourneySteps({ stage }: { stage: WmsStage }) {
  const at = ORDER[stage];
  return (
    <div className="wj-steps" title={WMS_STAGE_LABEL[stage]}>
      {STEPS.map((s, i) => (
        <span key={s.key} className={`wj-step${i < at ? " done" : i === at ? " now" : ""}`}>
          <i />
          <em>{s.label}</em>
        </span>
      ))}
    </div>
  );
}

export function useWmsJourney() {
  const trackerQ = usePortalWmsTracker();
  const movesQ = useWmsMoves();
  const locQ = useWmsLocations();
  const whQ = useWmsWarehouses();
  return useMemo(() => {
    const tracker = new Map((trackerQ.data ?? []).map((t) => [t.receipt_id, t]));
    const locById = new Map((locQ.data ?? []).map((l) => [l.id, l]));
    const stock = stockByLocation(movesQ.data ?? []);
    const whName = (id: string | null) => whQ.data?.find((w) => w.id === id)?.name ?? "ExPac warehouse";
    /** "Johannesburg Warehouse · A / B03" — where the goods sit now. */
    const whereOf = (r: WmsReceipt) => {
      const bays = stock
        .filter((s) => s.receipt_id === r.id)
        .map((s) => (s.location_id ? locationLabel(locById.get(s.location_id)) : null))
        .filter(Boolean);
      return [whName(r.warehouse_id), bays.join(", ")].filter(Boolean).join(" · ");
    };
    return { tracker, whereOf, loading: trackerQ.isLoading || movesQ.isLoading };
  }, [trackerQ.data, trackerQ.isLoading, movesQ.data, movesQ.isLoading, locQ.data, whQ.data]);
}

type Filter = "warehouse" | "shipped" | "all";

/** Customer Portal › Warehouse › Overview: every receipt with where it is and
 *  its stage, up to the shipment number it moved on. */
export default function PortalWmsOverview({
  receipts,
  loading,
  search,
  onOpen,
  toolsSlot,
}: {
  receipts: WmsReceipt[];
  loading: boolean;
  search: string;
  onOpen: (r: WmsReceipt) => void;
  toolsSlot: HTMLDivElement | null;
}) {
  const navigate = useNavigate();
  const jobsQ = useMyJobs();
  const j = useWmsJourney();
  const [filter, setFilter] = useState<Filter>("warehouse");
  // Ship from stock (0149): tick goods in store, then request a quote to ship them.
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setSel((p) => {
      const n2 = new Set(p);
      if (n2.has(id)) n2.delete(id);
      else n2.add(id);
      return n2;
    });
  const myJobs = new Set((jobsQ.data ?? []).map((x) => x.id));
  // Running storage + handling this month (estimate from the warehouse rates, 0150).
  const whQ = useWmsWarehouses();
  const movesQ = useWmsMoves();
  const accrued = useMemo(
    () => accruedThisMonth(whQ.data ?? [], receipts, movesQ.data ?? []),
    [whQ.data, receipts, movesQ.data],
  );
  const accruedTotal = [...accrued.values()].reduce((a, b) => a + b, 0);
  const exceptions = receipts.filter((r) => r.condition !== "good" && !r.exception_ack_at);

  const rows = receipts.map((r) => ({ r, t: j.tracker.get(r.id), stage: wmsStage(r, j.tracker.get(r.id)) }));
  const count = (st: WmsStage[]) => rows.filter((x) => st.includes(x.stage)).length;
  const n = search.trim().toLowerCase();
  const shown = rows.filter(
    (x) =>
      (filter === "all" || (filter === "shipped" ? x.stage === "shipped" : x.stage !== "shipped")) &&
      (!n ||
        [x.r.receipt_no, x.r.description, x.r.customer_reference, x.t?.shipment_ref, x.t?.house_no, x.t?.master_no, ...x.r.packages.map((p) => p.sku)]
          .join(" ")
          .toLowerCase()
          .includes(n)),
  );

  const shipmentCell = (t: WmsTrackerRow | undefined) => {
    if (!t?.shipment_ref) return "—";
    return t.shipment_id && myJobs.has(t.shipment_id) ? (
      <button
        type="button"
        className="link-btn job-ref"
        onClick={(e) => {
          e.stopPropagation();
          navigate(`/portal/shipments/${t.shipment_id}`);
        }}
      >
        {t.shipment_ref}
      </button>
    ) : (
      t.shipment_ref
    );
  };

  type Row = (typeof rows)[number];
  const columns: DataColumn<Row>[] = [
    {
      key: "pick",
      header: "Ship",
      fixed: true,
      width: 50,
      render: (x) =>
        x.r.on_hand > 0 ? (
          <input
            type="checkbox"
            checked={sel.has(x.r.id)}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggle(x.r.id)}
            title="Tick to request a quote to ship these goods"
          />
        ) : null,
    },
    { key: "no", header: "Receipt No", width: 110, render: (x) => <b>{x.r.receipt_no}</b>, sortValue: (x) => x.r.receipt_no },
    { key: "date", header: "Received", width: 100, render: (x) => formatDate(x.r.received_at), sortValue: (x) => x.r.received_at },
    { key: "where", header: "Where", width: 230, render: (x) => (x.stage === "shipped" ? "Left the warehouse" : j.whereOf(x.r)) },
    { key: "desc", header: "Description", width: 200, render: (x) => x.r.description || "—" },
    { key: "pcs", header: "In Motion Warehouse / received", width: 130, render: (x) => `${x.r.on_hand} / ${x.r.pieces} pcs`, sortValue: (x) => x.r.on_hand },
    { key: "cbm", header: "CBM", width: 80, render: (x) => qty(x.r.volume_cbm, 3) },
    {
      key: "storage",
      header: "Storage this month",
      width: 130,
      render: (x) => (accrued.get(x.r.id) ? money(accrued.get(x.r.id)) : "—"),
      sortValue: (x) => accrued.get(x.r.id) ?? 0,
    },
    { key: "stage", header: "Stage", width: 320, render: (x) => <JourneySteps stage={x.stage} />, sortValue: (x) => ORDER[x.stage] },
    { key: "ship", header: "Shipment No", width: 120, render: (x) => shipmentCell(x.t), sortValue: (x) => x.t?.shipment_ref ?? "" },
    {
      key: "house",
      header: "HAWB / HBL",
      width: 130,
      render: (x) => x.t?.house_no || (x.t?.consol_no ? x.t.consol_no : "—"),
    },
    { key: "transport", header: "Flight / Vessel", width: 140, render: (x) => x.t?.transport || "—" },
    { key: "etd", header: "ETD", width: 100, render: (x) => formatDate(x.t?.etd) },
    { key: "out", header: "Shipped on", width: 110, render: (x) => formatDate(x.t?.released_at), sortValue: (x) => x.t?.released_at ?? "" },
  ];

  return (
    <>
      <div className="pt-kpis">
        <Kpi label="In Motion Warehouse" value={count(["received", "checked", "preparing", "part_shipped"])} on={filter === "warehouse"} onClick={() => setFilter("warehouse")} />
        <Kpi label="Received" value={count(["received"])} />
        <Kpi label="Checked" value={count(["checked"])} />
        <Kpi label="Being prepared for shipping" value={count(["preparing", "part_shipped"])} />
        <Kpi label="Shipped" value={count(["shipped"])} on={filter === "shipped"} onClick={() => setFilter("shipped")} />
        <div className="pt-kpi" title="Storage and handling so far this month, excl. VAT, estimated from the warehouse rates">
          <span className="pt-kpi-label">Storage this month (est.)</span>
          <span />
          <span className="pt-kpi-value" style={{ fontSize: "1.3rem" }}>{money(accruedTotal)}</span>
        </div>
      </div>
      {exceptions.length > 0 && (
        <div className="pt-note warn">
          {exceptions.length} receipt{exceptions.length === 1 ? "" : "s"} arrived with an exception (damaged, wet, short or over).{" "}
          <button type="button" className="link-btn" onClick={() => navigate("/portal/warehouse?view=exceptions")}>
            Review and acknowledge
          </button>
        </div>
      )}
      <div className="panel">
        <div className="panel-head">
          <h2>Your goods with ExPac</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            disabled={sel.size === 0}
            title={sel.size ? undefined : "Tick goods in the Ship column first"}
            onClick={() => navigate("/portal/quotes/new", { state: { fromStock: [...sel] } })}
          >
            Request a quote to ship{sel.size ? ` (${sel.size})` : ""}
          </button>
          <div className="wms-seg">
            {(
              [
                ["warehouse", "In Motion Warehouse"],
                ["shipped", "Shipped"],
                ["all", "All"],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
          </div>
        </div>
        {loading || j.loading ? (
          <Loading />
        ) : receipts.length === 0 ? (
          <EmptyState>
            Nothing of yours in the ExPac warehouse yet. When we receive goods for you, each delivery shows here: where it's stored,
            when it's checked, when it's being prepared for shipping, and the shipment it leaves on.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>Nothing here.</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-wms-overview"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={shown}
            rowKey={(x) => x.r.id}
            onRowClick={(x) => onOpen(x.r)}
          />
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, on, onClick }: { label: string; value: number; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`pt-kpi wj-kpi${on ? " amber" : ""}`} onClick={onClick} disabled={!onClick}>
      <span className="pt-kpi-label">{label}</span>
      <span />
      <span className="pt-kpi-value">{value}</span>
    </button>
  );
}
