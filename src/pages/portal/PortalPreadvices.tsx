import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import { EmptyState, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  PACKAGE_TYPES,
  PREADVICE_STATUS,
  cancelPreadvice,
  createPreadvice,
  packageTotals,
  qty,
  useWmsPreadvices,
  type WmsPackage,
  type WmsPreadvice,
  type WmsReceipt,
} from "../../lib/wms";

/** Customer Portal › Warehouse › Pre-advise goods (0149): tell ExPac what's on
 *  its way to the warehouse; ExPac receives against it. */
export default function PortalPreadvices({ receipts, toolsSlot }: { receipts: WmsReceipt[]; toolsSlot: HTMLDivElement | null }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useWmsPreadvices();
  const [creating, setCreating] = useState(false);
  const recNo = new Map(receipts.map((r) => [r.id, r.receipt_no]));
  const rows = q.data ?? [];

  const columns: DataColumn<WmsPreadvice>[] = [
    { key: "no", header: "Pre-advice No", width: 120, render: (p) => <b>{p.preadvice_no}</b>, sortValue: (p) => p.preadvice_no },
    { key: "date", header: "Sent", width: 100, render: (p) => formatDate(p.created_at), sortValue: (p) => p.created_at },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (p) => <span className={`badge ${PREADVICE_STATUS[p.status].cls}`}>{PREADVICE_STATUS[p.status].label}</span>,
    },
    { key: "supplier", header: "From (supplier)", width: 180, render: (p) => p.supplier || "—" },
    { key: "eta", header: "ETA", width: 100, render: (p) => formatDate(p.eta), sortValue: (p) => p.eta ?? "" },
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
    {
      key: "outcome",
      header: "Receipt",
      width: 140,
      render: (p) =>
        p.receipt_id ? (
          recNo.get(p.receipt_id) ?? "Received"
        ) : p.status === "expected" ? (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (!confirm(`Cancel ${p.preadvice_no}?`)) return;
              try {
                await cancelPreadvice(p.id);
                qc.invalidateQueries({ queryKey: ["wms", "preadvices"] });
                toast("Pre-advice cancelled");
              } catch (e) {
                error(e instanceof Error ? e.message : "Could not cancel");
              }
            }}
          >
            Cancel
          </button>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Pre-advise goods</h2>
          <p>Tell us what's on its way to the Motion Warehouse, we'll be ready to receive it.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          + Pre-advise goods
        </button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No pre-advices yet. Let us know when goods are coming to the warehouse.</EmptyState>
      ) : (
        <DataTable tableKey="portal-preadvices" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(p) => p.id} />
      )}
      {creating && (
        <PreadviceModal
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["wms", "preadvices"] });
          }}
        />
      )}
    </div>
  );
}

const blank = (): WmsPackage => ({ sku: "", description: "", type: "Cartons", qty: 1, length_cm: "", width_cm: "", height_cm: "", actual_kg: "" });

function PreadviceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast, error } = useToast();
  const [supplier, setSupplier] = useState("");
  const [eta, setEta] = useState("");
  const [ref, setRef] = useState("");
  const [carrier, setCarrier] = useState("");
  const [desc, setDesc] = useState("");
  const [notes, setNotes] = useState("");
  const [pk, setPk] = useState<WmsPackage[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const t = packageTotals(pk);
  const setRow = (i: number, patch: Partial<WmsPackage>) => setPk((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit() {
    if (!supplier.trim() && !desc.trim()) return error("Who is it from, or what is it?");
    setBusy(true);
    try {
      await createPreadvice({
        supplier,
        eta,
        inbound_ref: ref,
        carrier,
        description: desc,
        notes,
        packages: pk.filter((p) => p.sku || p.description || Number(p.qty) > 0),
      });
      toast("Pre-advice sent, the warehouse team has been notified");
      onDone();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Pre-advise goods to the Motion Warehouse" onClose={onClose} wide stickyHeader>
      <div className="grid4">
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>From (supplier / shipper)</label>
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Expected arrival</label>
          <DateInput value={eta} onChange={setEta} />
        </div>
        <div className="field">
          <label>Delivered by (courier / transporter)</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        </div>
      </div>
      <div className="grid2">
        <div className="field">
          <label>Waybill / tracking / delivery note no</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <div className="field">
          <label>Description of goods</label>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>
      <h4 className="wms-subhead">Packages / items</h4>
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
            {pk.map((p, i) => (
              <tr key={i}>
                <td>
                  <input value={p.sku ?? ""} onChange={(e) => setRow(i, { sku: e.target.value })} />
                </td>
                <td>
                  <input value={p.description ?? ""} onChange={(e) => setRow(i, { description: e.target.value })} />
                </td>
                <td>
                  <select value={p.type ?? ""} onChange={(e) => setRow(i, { type: e.target.value })}>
                    {PACKAGE_TYPES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </td>
                {(["qty", "length_cm", "width_cm", "height_cm", "actual_kg"] as const).map((k) => (
                  <td key={k}>
                    <input type="number" step="any" value={p[k] as string | number} onChange={(e) => setRow(i, { [k]: e.target.value })} />
                  </td>
                ))}
                <td>
                  {pk.length > 1 && (
                    <button type="button" className="row-icon-btn danger" onClick={() => setPk((rows) => rows.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="wms-pkg-foot">
        <button type="button" className="btn outline btn-sm" onClick={() => setPk((rows) => [...rows, blank()])}>
          + Add item
        </button>
        <span className="hint">
          {t.pieces} pcs · {qty(t.kg)} kg · {qty(t.cbm, 3)} CBM
        </span>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. fragile, keep dry, deliver to bonded area" />
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? "Sending…" : "Send pre-advice"}
        </button>
      </div>
    </Modal>
  );
}
