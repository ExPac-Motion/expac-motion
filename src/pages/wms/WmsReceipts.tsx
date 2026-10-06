import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  SearchInput,
  useRowSelection,
  type BulkField,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  CONDITION_LABEL,
  PACKAGE_TYPES,
  bulkUpdateReceipts,
  setReceiptChecked,
  useWmsPreadvices,
  markPreadviceReceived,
  PREADVICE_STATUS,
  type WmsPreadvice,
  daysBetween,
  packageTotals,
  qty,
  useWmsMoves,
  useWmsMutation,
  useWmsReceipts,
  wmsDb,
  type ReceiptCondition,
  type WmsPackage,
  type WmsReceipt,
  type WmsReceiptInput,
} from "../../lib/wms";
import { LocationOptions, ReceiptStatusBadge, orNull, useWmsLookups } from "./shared";
import ReceiptImages from "./ReceiptImages";
import { notifyWms } from "../../lib/wmsNotify";
import { useQueryClient } from "@tanstack/react-query";

type StatusFilter = "stock" | "in_store" | "part_released" | "released" | "all" | "expected";

/** WMS > Warehouse Receipt: goods received into a warehouse (WR000001). */
export default function WmsReceipts() {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("stock");
  const [whId, setWhId] = useState("");
  const [editing, setEditing] = useState<WmsReceipt | "new" | null>(null);
  const [viewing, setViewing] = useState<WmsReceipt | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const del = useWmsMutation(wmsDb.deleteReceipt);
  const bulk = useWmsMutation((v: { ids: string[]; patch: Record<string, unknown> }) =>
    bulkUpdateReceipts(v.ids, v.patch),
  );

  const rows = receiptsQ.data ?? [];
  const moves = movesQ.data ?? [];

  // Bays each receipt currently sits in.
  const baysOf = useMemo(() => {
    const m = new Map<string, Map<string | null, number>>();
    for (const mv of moves) {
      const per = m.get(mv.receipt_id) ?? new Map<string | null, number>();
      per.set(mv.location_id, (per.get(mv.location_id) ?? 0) + mv.qty);
      m.set(mv.receipt_id, per);
    }
    return (id: string) =>
      [...(m.get(id) ?? new Map()).entries()]
        .filter(([, q]) => q > 0)
        .map(([loc]) => lk.locName(loc))
        .join(", ");
  }, [moves, lk]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (whId && r.warehouse_id !== whId) return false;
      if (status === "stock" && r.status === "released") return false;
      if (status !== "stock" && status !== "all" && r.status !== status) return false;
      if (!q) return true;
      const skus = r.packages.map((p) => `${p.sku ?? ""} ${p.description ?? ""}`).join(" ");
      return [
        r.receipt_no,
        r.description,
        r.marks,
        r.inbound_ref,
        r.customer_reference,
        lk.clientName(r.client_id),
        lk.jobRef(r.job_id),
        skus,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, search, status, whId, lk]);

  const sel = useRowSelection(rows, filtered);

  const columns: DataColumn<WmsReceipt>[] = [
    {
      key: "actions",
      fixed: true,
      width: 128,
      header: <RowActionsHead checked={sel.allChecked} indeterminate={sel.someChecked} onToggle={sel.toggleAll} />,
      render: (r) => (
        <RowActions
          selected={sel.isSelected(r.id)}
          onSelectToggle={() => sel.toggle(r.id)}
          onView={() => setViewing(r)}
          onEdit={() => setEditing(r)}
          onDelete={() => {
            if (!confirm(`Delete ${r.receipt_no}? Its movements and stock history go with it.`)) return;
            del.mutate(r.id, { onSuccess: () => toast("Receipt deleted"), onError: (e) => error(e.message) });
          }}
        />
      ),
    },
    { key: "no", header: "Receipt No", width: 110, render: (r) => <b>{r.receipt_no}</b>, sortValue: (r) => r.receipt_no },
    { key: "date", header: "Received", width: 100, render: (r) => formatDate(r.received_at), sortValue: (r) => r.received_at },
    { key: "client", header: "Customer", width: 180, render: (r) => lk.clientName(r.client_id), sortValue: (r) => lk.clientName(r.client_id) },
    { key: "job", header: "Shipment", width: 110, render: (r) => lk.jobRef(r.job_id), sortValue: (r) => lk.jobRef(r.job_id) },
    { key: "wh", header: "Warehouse", width: 90, render: (r) => lk.whCode(r.warehouse_id) },
    { key: "bay", header: "Zone / bay", width: 120, render: (r) => baysOf(r.id) || "—" },
    { key: "desc", header: "Description", width: 200, render: (r) => r.description || "—" },
    { key: "skus", header: "SKUs", width: 70, render: (r) => r.packages.filter((p) => p.sku).length || "—", defaultHidden: true },
    { key: "ref", header: "Inbound ref", width: 120, render: (r) => r.inbound_ref || "—", defaultHidden: true },
    { key: "pcs", header: "Pieces", width: 70, render: (r) => r.pieces, sortValue: (r) => r.pieces },
    { key: "onhand", header: "On hand", width: 80, render: (r) => r.on_hand, sortValue: (r) => r.on_hand },
    { key: "kg", header: "Kg", width: 80, render: (r) => qty(r.gross_kg), sortValue: (r) => r.gross_kg },
    { key: "cbm", header: "CBM", width: 80, render: (r) => qty(r.volume_cbm, 3), sortValue: (r) => r.volume_cbm },
    {
      key: "cond",
      header: "Condition",
      width: 120,
      render: (r) => <span className={r.condition !== "good" ? "wms-warn" : undefined}>{CONDITION_LABEL[r.condition]}</span>,
    },
    {
      key: "exack",
      header: "Exception",
      width: 130,
      render: (r) =>
        r.condition === "good" ? "—" : r.exception_ack_at ? <span className="wms-ok">✓ Acknowledged</span> : <span className="wms-warn">Awaiting customer</span>,
      sortValue: (r) => (r.condition === "good" ? "" : r.exception_ack_at ?? "0"),
    },
    {
      key: "checked",
      header: "Checked",
      width: 100,
      render: (r) => (r.checked_at ? <span className="wms-ok">✓ {formatDate(r.checked_at)}</span> : "—"),
      sortValue: (r) => r.checked_at ?? "",
    },
    {
      key: "days",
      header: "Days",
      width: 60,
      render: (r) => (r.status === "released" ? "—" : daysBetween(r.received_at, new Date())),
      sortValue: (r) => daysBetween(r.received_at, new Date()),
    },
    { key: "status", header: "Status", width: 120, render: (r) => <ReceiptStatusBadge status={r.status} /> },
  ];

  const bulkFields: BulkField[] = [
    {
      key: "client_id",
      label: "Customer",
      type: "select",
      options: lk.clients.map((c) => ({ value: c.id, label: c.company })),
    },
    {
      key: "job_id",
      label: "Shipment",
      type: "select",
      options: lk.jobs.map((j) => ({ value: j.id, label: j.reference })),
    },
    { key: "customer_reference", label: "Customer reference", type: "text" },
    {
      key: "condition",
      label: "Condition",
      type: "select",
      allowClear: false,
      options: Object.entries(CONDITION_LABEL).map(([value, label]) => ({ value, label })),
    },
    { key: "hazardous", label: "Hazardous", type: "toggle" },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search receipt, customer, SKU…" />}
        filters={
          <>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} style={{ width: "auto" }}>
              <option value="stock">In stock</option>
              <option value="in_store">In store (untouched)</option>
              <option value="part_released">Part released</option>
              <option value="released">Released</option>
              <option value="all">All receipts</option>
              <option value="expected">Expected (pre-advised)</option>
            </select>
            {lk.warehouses.length > 1 && (
              <select value={whId} onChange={(e) => setWhId(e.target.value)} style={{ width: "auto" }}>
                <option value="">All warehouses</option>
                {lk.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            )}
          </>
        }
        count={receiptsQ.isLoading ? undefined : `${filtered.length} receipt${filtered.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setEditing("new")} disabled={lk.warehouses.length === 0}>
            + New receipt
          </button>
        }
      >
        <button className="btn outline bulk" onClick={() => setBulkOpen(true)} disabled={sel.count === 0}>
          Bulk Edit{sel.count ? ` (${sel.count})` : ""}
        </button>
      </PageTools>

      {status === "expected" ? (
        <ExpectedList toolsSlot={toolsSlot} />
      ) : (
      <div className="panel">
        {receiptsQ.isLoading ? (
          <Loading />
        ) : receiptsQ.isError ? (
          <ErrorNote error={receiptsQ.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No goods received yet. + New receipt books cargo into the warehouse.</EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState>No receipts match.</EmptyState>
        ) : (
          <DataTable
            tableKey="wms-receipts"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setViewing(r)}
          />
        )}
      </div>
      )}

      {editing !== null && (
        <ReceiptEditModal
          receipt={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            if (editing === "new") navigate(`/wms/print/receipt/${id}`);
          }}
        />
      )}
      {viewing && (
        <ReceiptViewModal
          receipt={rows.find((r) => r.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}
      {bulkOpen && (
        <BulkEditModal
          title="Bulk edit receipts"
          noun="receipt"
          count={sel.count}
          fields={bulkFields}
          busy={bulk.isPending}
          onClose={() => setBulkOpen(false)}
          onApply={(patch) =>
            bulk.mutate(
              { ids: sel.ids, patch },
              {
                onSuccess: () => {
                  toast(`${sel.count} receipt${sel.count === 1 ? "" : "s"} updated`);
                  setBulkOpen(false);
                  sel.clear();
                },
                onError: (e) => error(e.message),
              },
            )
          }
        />
      )}
    </>
  );
}

/* ---------- View ---------- */

function ReceiptViewModal({
  receipt: r,
  onClose,
  onEdit,
}: {
  receipt: WmsReceipt;
  onClose: () => void;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const movesQ = useWmsMoves();
  const history = (movesQ.data ?? []).filter((m) => m.receipt_id === r.id);
  const KIND: Record<string, string> = { receipt: "Received", move: "Moved", release: "Released", adjust: "Count adjustment" };
  const fields: [string, string][] = [
    ["Received", formatDateTime(r.received_at)],
    ["Received by", lk.person(r.received_by)],
    ["Warehouse", lk.warehouse(r.warehouse_id)?.name ?? "—"],
    ["Customer", lk.clientName(r.client_id)],
    ["Shipment", lk.jobRef(r.job_id)],
    ["Shipper", lk.supplier(r.supplier_id)?.company ?? "—"],
    ["Inbound ref (waybill / DN)", r.inbound_ref || "—"],
    ["Customer reference", r.customer_reference || "—"],
    ["Delivered by", r.delivered_by || "—"],
    ["Vehicle reg", r.vehicle_reg || "—"],
    ["Driver", r.driver_name || "—"],
    ["Package type", r.package_type || "—"],
    ["Pieces / on hand", `${r.pieces} / ${r.on_hand}`],
    ["Pallets", String(r.pallets)],
    ["Gross kg", qty(r.gross_kg)],
    ["CBM", qty(r.volume_cbm, 3)],
    ["Condition", CONDITION_LABEL[r.condition] + (r.condition_notes ? `, ${r.condition_notes}` : "")],
    ["Hazardous", r.hazardous ? "Yes" : "No"],
    ...(r.condition !== "good"
      ? ([
          [
            "Customer acknowledged",
            r.exception_ack_at
              ? formatDateTime(r.exception_ack_at) + (r.exception_customer_note ? ", " + r.exception_customer_note : "")
              : "Not yet",
          ],
        ] as [string, string][])
      : []),
    ["Checked", r.checked_at ? `${formatDateTime(r.checked_at)}, ${lk.person(r.checked_by)}` : "Not yet"],
  ];
  const qc = useQueryClient();
  const { error } = useToast();
  const [checking, setChecking] = useState(false);
  async function toggleChecked() {
    setChecking(true);
    try {
      await setReceiptChecked(r.id, !r.checked_at);
      if (!r.checked_at) void notifyWms("checked", [r.id]);
      qc.invalidateQueries({ queryKey: ["wms"] });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setChecking(false);
    }
  }
  return (
    <Modal
      title={`${r.receipt_no}, ${lk.clientName(r.client_id)}`}
      onClose={onClose}
      wide
      headerActions={
        <>
          <ReceiptStatusBadge status={r.status} />
          <button
            className={`btn btn-sm${r.checked_at ? " outline" : ""}`}
            onClick={toggleChecked}
            disabled={checking}
            title={r.checked_at ? "Undo the checked step" : "Goods inspected and measured, shows as Checked on the customer portal"}
          >
            {r.checked_at ? "✓ Checked" : "Mark as checked"}
          </button>
          <button className="btn outline btn-sm" onClick={() => navigate(`/wms/print/receipt/${r.id}`)}>
            Print WR
          </button>
          <button className="btn btn-sm" onClick={onEdit}>
            Edit
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
      {(r.description || r.marks || r.notes) && (
        <div className="wms-fields" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <div className="k">Description</div>
            <div className="v">{r.description || "—"}</div>
          </div>
          <div>
            <div className="k">Marks &amp; numbers</div>
            <div className="v" style={{ whiteSpace: "pre-line" }}>{r.marks || "—"}</div>
          </div>
          <div>
            <div className="k">Notes</div>
            <div className="v" style={{ whiteSpace: "pre-line" }}>{r.notes || "—"}</div>
          </div>
        </div>
      )}
      <h4 className="wms-subhead">Images</h4>
      <ReceiptImages receiptId={r.id} editable />
      <h4 className="wms-subhead">Package items</h4>
      {r.packages.length === 0 ? (
        <p className="hint">No package items captured.</p>
      ) : (
        <PackagesTable packages={r.packages} />
      )}
      <h4 className="wms-subhead">Stock history</h4>
      <table className="table--compact wms-mini">
        <thead>
          <tr>
            <th>Date</th>
            <th>What</th>
            <th>Zone / bay</th>
            <th>Pieces</th>
          </tr>
        </thead>
        <tbody>
          {history.map((m) => (
            <tr key={m.id}>
              <td>{formatDateTime(m.at)}</td>
              <td>{KIND[m.kind]}</td>
              <td>{lk.locName(m.location_id)}</td>
              <td className={m.qty < 0 ? "wms-neg" : undefined}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function PackagesTable({ packages }: { packages: WmsPackage[] }) {
  const t = packageTotals(packages);
  return (
    <table className="table--compact wms-mini">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Description</th>
          <th>Type</th>
          <th>Qty</th>
          <th>L × W × H (cm)</th>
          <th>Kg / unit</th>
          <th>Total kg</th>
          <th>Total CBM</th>
        </tr>
      </thead>
      <tbody>
        {packages.map((p, i) => {
          const q = Number(p.qty) || 0;
          const cbm = ((Number(p.length_cm) || 0) * (Number(p.width_cm) || 0) * (Number(p.height_cm) || 0)) / 1_000_000;
          return (
            <tr key={i}>
              <td>{p.sku || "—"}</td>
              <td>{p.description || "—"}</td>
              <td>{p.type || "—"}</td>
              <td>{q}</td>
              <td>
                {qty(Number(p.length_cm))} × {qty(Number(p.width_cm))} × {qty(Number(p.height_cm))}
              </td>
              <td>{qty(Number(p.actual_kg))}</td>
              <td>{qty((Number(p.actual_kg) || 0) * q)}</td>
              <td>{qty(cbm * q, 3)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3}>Totals</td>
          <td>{t.pieces}</td>
          <td />
          <td />
          <td>{qty(t.kg)}</td>
          <td>{qty(t.cbm, 3)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ---------- Create / edit ---------- */

const blankPackage = (): WmsPackage => ({
  sku: "",
  description: "",
  type: "Cartons",
  qty: 1,
  length_cm: "",
  width_cm: "",
  height_cm: "",
  actual_kg: "",
});

export function ReceiptEditModal({
  receipt,
  onClose,
  onSaved,
  defaults,
}: {
  receipt: WmsReceipt | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  defaults?: Partial<WmsReceiptInput>;
}) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const movesQ = useWmsMoves();
  const save = useWmsMutation((v: { id?: string; values: WmsReceiptInput }) => wmsDb.saveReceipt(v.id, v.values));

  const firstWh = lk.warehouses.find((w) => w.active)?.id ?? lk.warehouses[0]?.id ?? "";
  const [f, setF] = useState<WmsReceiptInput>(() =>
    receipt
      ? (() => {
          // Only the table's own columns go back on save (not the view's on-hand / status).
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id, receipt_no, created_at, received_by, on_hand, on_hand_kg, on_hand_cbm, last_out_at, status, checked_at, checked_by, notified, exception_ack_at, exception_ack_by, exception_customer_note, ...rest } = receipt as WmsReceipt & { notified?: unknown };
          return rest;
        })()
      : {
          warehouse_id: firstWh,
          location_id: null,
          client_id: null,
          job_id: null,
          supplier_id: null,
          received_at: new Date().toISOString(),
          delivered_by: null,
          vehicle_reg: null,
          driver_name: null,
          inbound_ref: null,
          customer_reference: null,
          description: null,
          marks: null,
          package_type: "Cartons",
          pieces: 0,
          pallets: 0,
          gross_kg: 0,
          volume_cbm: 0,
          packages: [],
          condition: "good",
          condition_notes: null,
          hazardous: false,
          notes: null,
          ...defaults,
        },
  );
  const set = <K extends keyof WmsReceiptInput>(k: K, v: WmsReceiptInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const str = (k: keyof WmsReceiptInput) => (f[k] as string | null) ?? "";

  // Pieces and bay lock once stock has moved / left (the ledger trigger enforces it too).
  const locked =
    !!receipt && (movesQ.data ?? []).some((m) => m.receipt_id === receipt.id && m.kind !== "receipt");

  const totals = packageTotals(f.packages);
  const setPkg = (i: number, patch: Partial<WmsPackage>) =>
    set(
      "packages",
      f.packages.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );

  function fillFromItems() {
    setF((p) => ({
      ...p,
      pieces: locked ? p.pieces : totals.pieces,
      gross_kg: Math.round(totals.kg * 100) / 100,
      volume_cbm: Math.round(totals.cbm * 1000) / 1000,
    }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.warehouse_id) return error("Pick a warehouse");
    if (!f.client_id) return error("Pick the customer the goods belong to");
    if (!(Number(f.pieces) > 0)) return error("Enter the number of pieces received");
    const values: WmsReceiptInput = {
      ...f,
      pieces: Number(f.pieces) || 0,
      pallets: Number(f.pallets) || 0,
      gross_kg: Number(f.gross_kg) || 0,
      volume_cbm: Number(f.volume_cbm) || 0,
      packages: f.packages.filter((p) => p.sku || p.description || Number(p.qty) > 0),
    };
    save.mutate(
      { id: receipt?.id, values },
      {
        onSuccess: (id) => {
          toast(receipt ? "Receipt saved" : "Goods received");
          // Customer email: goods received (0149), once per receipt.
          if (!receipt) void notifyWms("received", [id]);
          onSaved?.(id);
          if (!onSaved) onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }

  const clientJobs = lk.jobs.filter((j) => !f.client_id || j.client_id === f.client_id || j.id === f.job_id);
  const recDate = f.received_at.slice(0, 10);

  return (
    <Modal title={receipt ? `Edit ${receipt.receipt_no}` : "New warehouse receipt"} onClose={onClose} wide stickyHeader>
      <form onSubmit={submit}>
        <div className="grid4">
          <div className="field">
            <label>Warehouse</label>
            <select
              value={f.warehouse_id}
              disabled={locked}
              onChange={(e) => setF((p) => ({ ...p, warehouse_id: e.target.value, location_id: null }))}
            >
              {lk.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}, {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Zone / bay</label>
            <select
              value={f.location_id ?? ""}
              disabled={locked}
              title={locked ? "Stock has moved, use Warehouse Movements" : undefined}
              onChange={(e) => set("location_id", orNull(e.target.value))}
            >
              <option value="">Unassigned</option>
              <LocationOptions locations={lk.locations} warehouseId={f.warehouse_id} />
            </select>
          </div>
          <div className="field">
            <label>Date received</label>
            <DateInput
              value={recDate}
              onChange={(v) => {
                if (!v) return;
                const t = new Date(f.received_at);
                const d = new Date(`${v}T00:00:00`);
                d.setHours(t.getHours(), t.getMinutes());
                set("received_at", d.toISOString());
              }}
            />
          </div>
          <div className="field">
            <label>Condition</label>
            <select value={f.condition} onChange={(e) => set("condition", e.target.value as ReceiptCondition)}>
              {Object.entries(CONDITION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid3">
          <div className="field">
            <label>Customer</label>
            <select value={f.client_id ?? ""} onChange={(e) => set("client_id", orNull(e.target.value))}>
              <option value="">—</option>
              {lk.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Shipment (optional)</label>
            <select
              value={f.job_id ?? ""}
              onChange={(e) => {
                const id = orNull(e.target.value);
                const j = lk.job(id);
                setF((p) => ({
                  ...p,
                  job_id: id,
                  client_id: p.client_id ?? j?.client_id ?? null,
                  supplier_id: p.supplier_id ?? j?.supplier_id ?? null,
                  customer_reference: p.customer_reference ?? j?.po_no ?? null,
                }));
              }}
            >
              <option value="">No shipment, storage only</option>
              {clientJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.reference}
                  {j.client?.company ? `, ${j.client.company}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Shipper / supplier</label>
            <select value={f.supplier_id ?? ""} onChange={(e) => set("supplier_id", orNull(e.target.value))}>
              <option value="">—</option>
              {lk.suppliers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid4">
          <div className="field">
            <label>Inbound ref (waybill / DN)</label>
            <input value={str("inbound_ref")} onChange={(e) => set("inbound_ref", orNull(e.target.value))} />
          </div>
          <div className="field">
            <label>Customer reference</label>
            <input value={str("customer_reference")} onChange={(e) => set("customer_reference", orNull(e.target.value))} />
          </div>
          <div className="field">
            <label>Delivered by (carrier)</label>
            <input value={str("delivered_by")} onChange={(e) => set("delivered_by", orNull(e.target.value))} />
          </div>
          <div className="grid2" style={{ gap: 8 }}>
            <div className="field">
              <label>Vehicle reg</label>
              <input value={str("vehicle_reg")} onChange={(e) => set("vehicle_reg", orNull(e.target.value))} />
            </div>
            <div className="field">
              <label>Driver</label>
              <input value={str("driver_name")} onChange={(e) => set("driver_name", orNull(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label>Description of goods</label>
            <input value={str("description")} onChange={(e) => set("description", orNull(e.target.value))} />
          </div>
          <div className="field">
            <label>Marks &amp; numbers</label>
            <input value={str("marks")} onChange={(e) => set("marks", orNull(e.target.value))} />
          </div>
        </div>

        <h4 className="wms-subhead">
          Package items
          <span className="hint" style={{ fontWeight: 400, marginLeft: 8 }}>
            SKU, quantity and per-unit dimensions / weight
          </span>
        </h4>
        <div className="wms-pkg-wrap">
          <table className="table--compact wms-pkg">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Description</th>
                <th>Type</th>
                <th>Qty</th>
                <th>L (cm)</th>
                <th>W (cm)</th>
                <th>H (cm)</th>
                <th>Kg / unit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {f.packages.map((p, i) => (
                <tr key={i}>
                  <td>
                    <input value={p.sku ?? ""} onChange={(e) => setPkg(i, { sku: e.target.value })} />
                  </td>
                  <td>
                    <input value={p.description ?? ""} onChange={(e) => setPkg(i, { description: e.target.value })} />
                  </td>
                  <td>
                    <select value={p.type ?? ""} onChange={(e) => setPkg(i, { type: e.target.value })}>
                      {PACKAGE_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  {(["qty", "length_cm", "width_cm", "height_cm", "actual_kg"] as const).map((k) => (
                    <td key={k}>
                      <input
                        type="number"
                        step="any"
                        value={p[k] as string | number}
                        onChange={(e) => setPkg(i, { [k]: e.target.value })}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="row-icon-btn danger"
                      title="Remove item"
                      onClick={() => set("packages", f.packages.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="wms-pkg-foot">
          <button type="button" className="btn outline btn-sm" onClick={() => set("packages", [...f.packages, blankPackage()])}>
            + Add item
          </button>
          {f.packages.length > 0 && (
            <>
              <span className="hint">
                Items: {totals.pieces} pcs · {qty(totals.kg)} kg · {qty(totals.cbm, 3)} CBM
              </span>
              <button type="button" className="link-btn" onClick={fillFromItems}>
                Use item totals below
              </button>
            </>
          )}
        </div>

        <div className="grid4" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          <div className="field">
            <label>Package type</label>
            <select value={str("package_type")} onChange={(e) => set("package_type", orNull(e.target.value))}>
              {PACKAGE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Pieces</label>
            <input
              type="number"
              min={0}
              value={f.pieces}
              disabled={locked}
              title={locked ? "Stock has moved, use a cycle count to correct pieces" : undefined}
              onChange={(e) => set("pieces", e.target.value as unknown as number)}
            />
          </div>
          <div className="field">
            <label>Pallets</label>
            <input type="number" min={0} value={f.pallets} onChange={(e) => set("pallets", e.target.value as unknown as number)} />
          </div>
          <div className="field">
            <label>Gross kg</label>
            <input type="number" step="any" value={f.gross_kg} onChange={(e) => set("gross_kg", e.target.value as unknown as number)} />
          </div>
          <div className="field">
            <label>CBM</label>
            <input type="number" step="any" value={f.volume_cbm} onChange={(e) => set("volume_cbm", e.target.value as unknown as number)} />
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label>Condition notes</label>
            <input value={str("condition_notes")} onChange={(e) => set("condition_notes", orNull(e.target.value))} placeholder="e.g. 2 cartons crushed, photos taken" />
          </div>
          <div className="field">
            <label>Notes</label>
            <input value={str("notes")} onChange={(e) => set("notes", orNull(e.target.value))} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.hazardous} onChange={(e) => set("hazardous", e.target.checked)} /> Hazardous / dangerous goods
        </label>

        <div className="modal-foot-row">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={save.isPending}>
            {save.isPending ? "Saving…" : receipt ? "Save" : "Receive goods"}
          </button>
        </div>
        {!receipt && <p className="hint" style={{ textAlign: "right" }}>The Warehouse Receipt opens to print once saved.</p>}
      </form>
    </Modal>
  );
}

/* ---------- Expected goods (pre-advised by the customer, 0149) ---------- */

function ExpectedList({ toolsSlot }: { toolsSlot: HTMLDivElement | null }) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const q = useWmsPreadvices();
  const [receiving, setReceiving] = useState<WmsPreadvice | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = (q.data ?? []).filter((p) => showAll || p.status === "expected");

  const columns: DataColumn<WmsPreadvice>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 110,
      render: (p) =>
        p.status === "expected" ? (
          <button className="btn btn-sm" onClick={() => setReceiving(p)}>
            Receive
          </button>
        ) : (
          <span className={"badge " + PREADVICE_STATUS[p.status].cls}>{PREADVICE_STATUS[p.status].label}</span>
        ),
    },
    { key: "no", header: "Pre-advice No", width: 120, render: (p) => <b>{p.preadvice_no}</b>, sortValue: (p) => p.preadvice_no },
    { key: "client", header: "Customer", width: 180, render: (p) => lk.clientName(p.client_id), sortValue: (p) => lk.clientName(p.client_id) },
    { key: "eta", header: "ETA", width: 100, render: (p) => formatDate(p.eta), sortValue: (p) => p.eta ?? "" },
    { key: "supplier", header: "From (supplier)", width: 180, render: (p) => p.supplier || "—" },
    { key: "carrier", header: "Delivered by", width: 150, render: (p) => p.carrier || "—" },
    { key: "ref", header: "Waybill / tracking", width: 150, render: (p) => p.inbound_ref || "—" },
    { key: "desc", header: "Description", width: 200, render: (p) => p.description || "—" },
    {
      key: "pk",
      header: "Packages",
      width: 140,
      render: (p) => {
        const t = packageTotals(p.packages);
        return t.pieces ? `${t.pieces} pcs, ${qty(t.kg)} kg` : "—";
      },
    },
    { key: "sent", header: "Sent", width: 100, render: (p) => formatDate(p.created_at), sortValue: (p) => p.created_at },
  ];

  const pk = receiving ? packageTotals(receiving.packages) : null;
  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Expected goods</h2>
            <p>Pre-advised by customers on the portal. Receive opens a receipt filled in from the pre-advice.</p>
          </div>
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show received / cancelled
          </label>
        </div>
        {q.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState>No goods expected.</EmptyState>
        ) : (
          <DataTable tableKey="wms-preadvices" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(p) => p.id} />
        )}
      </div>
      {receiving && pk && (
        <ReceiptEditModal
          receipt={null}
          defaults={{
            client_id: receiving.client_id,
            inbound_ref: receiving.inbound_ref,
            delivered_by: receiving.carrier,
            description: receiving.description,
            packages: receiving.packages,
            pieces: pk.pieces,
            gross_kg: Math.round(pk.kg * 100) / 100,
            volume_cbm: Math.round(pk.cbm * 1000) / 1000,
            notes: ["Pre-advice " + receiving.preadvice_no, receiving.supplier ? "from " + receiving.supplier : null, receiving.notes]
              .filter(Boolean)
              .join(", "),
          }}
          onClose={() => setReceiving(null)}
          onSaved={async (id) => {
            try {
              await markPreadviceReceived(receiving, id);
            } catch (e) {
              error(e instanceof Error ? e.message : "Received, but the pre-advice could not be closed");
            }
            toast("Received against " + receiving.preadvice_no);
            setReceiving(null);
            q.refetch();
            navigate(`/wms/print/receipt/${id}`);
          }}
        />
      )}
    </>
  );
}
