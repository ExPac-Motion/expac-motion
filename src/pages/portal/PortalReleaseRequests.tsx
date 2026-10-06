import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import { EmptyState, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { usePortalMe } from "../../lib/portal";
import {
  RELEASE_REQUEST_STATUS,
  cancelReleaseRequest,
  qty,
  requestRelease,
  share,
  useWmsReleaseRequests,
  type WmsReceipt,
  type WmsReleaseRequest,
} from "../../lib/wms";

/** Customer Portal › Warehouse › Release requests (0148): ask ExPac to release
 *  goods in store (collect or deliver) and follow each request. */
export default function PortalReleaseRequests({
  receipts,
  toolsSlot,
}: {
  receipts: WmsReceipt[];
  toolsSlot: HTMLDivElement | null;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const reqQ = useWmsReleaseRequests();
  const [creating, setCreating] = useState(false);
  const recById = new Map(receipts.map((r) => [r.id, r]));
  const rows = reqQ.data ?? [];
  const inStore = receipts.filter((r) => r.on_hand > 0);

  const columns: DataColumn<WmsReleaseRequest>[] = [
    { key: "no", header: "Request No", width: 110, render: (r) => <b>{r.request_no}</b>, sortValue: (r) => r.request_no },
    { key: "date", header: "Requested", width: 100, render: (r) => formatDate(r.created_at), sortValue: (r) => r.created_at },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (r) => <span className={`badge ${RELEASE_REQUEST_STATUS[r.status].cls}`}>{RELEASE_REQUEST_STATUS[r.status].label}</span>,
    },
    { key: "method", header: "Collect / Deliver", width: 120, render: (r) => (r.method === "deliver" ? "Deliver" : "Collect") },
    { key: "needed", header: "Needed by", width: 100, render: (r) => formatDate(r.required_date) },
    {
      key: "goods",
      header: "Goods",
      width: 260,
      render: (r) => r.lines.map((l) => `${recById.get(l.receipt_id)?.receipt_no ?? "?"} × ${l.pieces} pcs`).join(", "),
    },
    {
      key: "outcome",
      header: "Outcome",
      width: 240,
      render: (r) =>
        r.status === "released" && r.release_id ? (
          <button type="button" className="link-btn" onClick={() => navigate(`/wms/print/release/${r.release_id}`)}>
            Release note
          </button>
        ) : r.status === "declined" ? (
          r.decline_reason || "Declined"
        ) : r.status === "requested" ? (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (!confirm(`Cancel ${r.request_no}?`)) return;
              try {
                await cancelReleaseRequest(r.id);
                qc.invalidateQueries({ queryKey: ["wms", "release-requests"] });
                toast("Request cancelled");
              } catch (e) {
                error(e instanceof Error ? e.message : "Could not cancel");
              }
            }}
          >
            Cancel request
          </button>
        ) : (
          "Cancelled"
        ),
    },
  ];

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Release requests</h2>
          <p>Ask ExPac to release goods from the warehouse, for collection or delivery.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)} disabled={inStore.length === 0} title={inStore.length ? undefined : "Nothing of yours is in store"}>
          + Request release
        </button>
      </div>
      {reqQ.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>{inStore.length ? "No release requests yet." : "Nothing of yours is in the warehouse to release yet."}</EmptyState>
      ) : (
        <DataTable tableKey="portal-release-requests" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}
      {creating && (
        <RequestModal
          inStore={inStore}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["wms", "release-requests"] });
          }}
        />
      )}
    </div>
  );
}

function RequestModal({ inStore, onClose, onDone }: { inStore: WmsReceipt[]; onClose: () => void; onDone: () => void }) {
  const { toast, error } = useToast();
  const meQ = usePortalMe();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"collect" | "deliver">("collect");
  const [date, setDate] = useState("");
  const [deliverTo, setDeliverTo] = useState(meQ.data?.physical_address || meQ.data?.address || "");
  const [collector, setCollector] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [idNo, setIdNo] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const lines = inStore.filter((r) => (picked[r.id] ?? 0) > 0).map((r) => ({ receipt_id: r.id, pieces: Math.min(picked[r.id], r.on_hand) }));
  const tot = lines.reduce(
    (t, l) => {
      const r = inStore.find((x) => x.id === l.receipt_id)!;
      const sh = share(r, l.pieces);
      return { pcs: t.pcs + l.pieces, kg: t.kg + sh.kg, cbm: t.cbm + sh.cbm };
    },
    { pcs: 0, kg: 0, cbm: 0 },
  );

  async function submit() {
    if (lines.length === 0) return error("Tick the goods to release");
    if (method === "deliver" && !deliverTo.trim()) return error("Where should we deliver?");
    setBusy(true);
    try {
      await requestRelease({
        method,
        required_date: date,
        deliver_to: method === "deliver" ? deliverTo : "",
        collector_name: method === "collect" ? collector : "",
        collector_vehicle: method === "collect" ? vehicle : "",
        collector_id_no: method === "collect" ? idNo : "",
        contact,
        notes,
        lines,
      });
      toast("Release requested, the ExPac team has been notified");
      onDone();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request a release" onClose={onClose} wide stickyHeader>
      <h4 className="wms-subhead" style={{ marginTop: 0 }}>
        Goods to release
      </h4>
      <table className="table--compact wms-mini">
        <thead>
          <tr>
            <th style={{ width: 30 }} />
            <th>Receipt</th>
            <th>Description</th>
            <th>SKUs</th>
            <th>In store</th>
            <th style={{ width: 100 }}>Release (pcs)</th>
          </tr>
        </thead>
        <tbody>
          {inStore.map((r) => {
            const on = (picked[r.id] ?? 0) > 0;
            return (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked ? r.on_hand : 0 }))} />
                </td>
                <td>{r.receipt_no}</td>
                <td>{r.description || "—"}</td>
                <td>{r.packages.map((p) => p.sku).filter(Boolean).join(", ") || "—"}</td>
                <td>{r.on_hand} pcs</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={r.on_hand}
                    value={picked[r.id] ?? 0}
                    onChange={(e) => setPicked((p) => ({ ...p, [r.id]: Math.max(0, Math.min(r.on_hand, Number(e.target.value) || 0)) }))}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        Releasing {tot.pcs} pcs · {qty(tot.kg)} kg · {qty(tot.cbm, 3)} CBM
      </p>

      <div className="grid3">
        <div className="field">
          <label>Collect or deliver?</label>
          <div className="wms-seg">
            <button type="button" className={method === "collect" ? "active" : ""} onClick={() => setMethod("collect")}>
              We'll collect
            </button>
            <button type="button" className={method === "deliver" ? "active" : ""} onClick={() => setMethod("deliver")}>
              Deliver to us
            </button>
          </div>
        </div>
        <div className="field">
          <label>Needed by</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div className="field">
          <label>Contact person / number</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
      </div>
      {method === "deliver" ? (
        <div className="field">
          <label>Delivery address</label>
          <textarea rows={3} value={deliverTo} onChange={(e) => setDeliverTo(e.target.value)} />
        </div>
      ) : (
        <div className="grid3">
          <div className="field">
            <label>Collected by (name)</label>
            <input value={collector} onChange={(e) => setCollector(e.target.value)} />
          </div>
          <div className="field">
            <label>Vehicle reg</label>
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          </div>
          <div className="field">
            <label>Driver ID number</label>
            <input value={idNo} onChange={(e) => setIdNo(e.target.value)} />
          </div>
        </div>
      )}
      <div className="field">
        <label>Notes / instructions</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. tail-lift needed, deliver before 12:00" />
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => void submit()} disabled={busy || lines.length === 0}>
          {busy ? "Sending…" : `Request release of ${tot.pcs} pcs`}
        </button>
      </div>
    </Modal>
  );
}
