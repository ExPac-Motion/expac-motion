import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
import { EmptyState, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime, money } from "../../lib/format";
import {
  CONDITION_LABEL,
  SERVICE_STATUS,
  SERVICE_TYPES,
  ackException,
  cancelService,
  requestService,
  useWmsServices,
  type WmsReceipt,
  type WmsServiceRequest,
} from "../../lib/wms";
import ReceiptImages from "../wms/ReceiptImages";

/* ---------- Exceptions (0150) ---------- */

/** Receipts that arrived damaged / wet / short / over / repacked: the report
 *  with ExPac's notes and photos, acknowledged by the customer. */
export function PortalExceptions({ receipts, toolsSlot }: { receipts: WmsReceipt[]; toolsSlot: HTMLDivElement | null }) {
  const [open, setOpen] = useState<WmsReceipt | null>(null);
  const rows = receipts.filter((r) => r.condition !== "good");
  const columns: DataColumn<WmsReceipt>[] = [
    {
      key: "act",
      header: "Actions",
      fixed: true,
      width: 110,
      render: (r) => (
        <button className={`btn btn-sm${r.exception_ack_at ? " outline" : ""}`} onClick={() => setOpen(r)}>
          {r.exception_ack_at ? "View" : "Review"}
        </button>
      ),
    },
    { key: "no", header: "Receipt No", width: 110, render: (r) => <b>{r.receipt_no}</b>, sortValue: (r) => r.receipt_no },
    { key: "date", header: "Received", width: 100, render: (r) => formatDate(r.received_at), sortValue: (r) => r.received_at },
    { key: "desc", header: "Description", width: 200, render: (r) => r.description || "—" },
    { key: "cond", header: "Exception", width: 140, render: (r) => <span className="wms-warn">{CONDITION_LABEL[r.condition]}</span> },
    { key: "notes", header: "ExPac notes", width: 260, render: (r) => r.condition_notes || "—" },
    {
      key: "ack",
      header: "Acknowledged",
      width: 140,
      render: (r) => (r.exception_ack_at ? `✓ ${formatDate(r.exception_ack_at)}` : <span className="wms-warn">Awaiting you</span>),
      sortValue: (r) => r.exception_ack_at ?? "",
    },
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Exceptions</h2>
          <p>Goods that arrived damaged, wet, short, over or repacked. Review the photos and acknowledge each report.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No exceptions, everything arrived in good order.</EmptyState>
      ) : (
        <DataTable tableKey="portal-wms-exceptions" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={setOpen} />
      )}
      {open && <ExceptionModal receipt={receipts.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ExceptionModal({ receipt: r, onClose }: { receipt: WmsReceipt; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const [note, setNote] = useState(r.exception_customer_note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Exception report, ${r.receipt_no}`} onClose={onClose} wide>
      <div className="wms-fields">
        <div>
          <div className="k">Received</div>
          <div className="v">{formatDateTime(r.received_at)}</div>
        </div>
        <div>
          <div className="k">Exception</div>
          <div className="v wms-warn">{CONDITION_LABEL[r.condition]}</div>
        </div>
        <div>
          <div className="k">Pieces</div>
          <div className="v">{r.pieces}</div>
        </div>
        <div>
          <div className="k">Description</div>
          <div className="v">{r.description || "—"}</div>
        </div>
      </div>
      <h4 className="wms-subhead">ExPac's notes</h4>
      <p style={{ whiteSpace: "pre-line", marginTop: 0 }}>{r.condition_notes || "No notes."}</p>
      <h4 className="wms-subhead">Photos</h4>
      <ReceiptImages receiptId={r.id} editable={false} />
      <h4 className="wms-subhead">Your acknowledgement</h4>
      {r.exception_ack_at ? (
        <p className="hint" style={{ marginTop: 0 }}>
          Acknowledged {formatDateTime(r.exception_ack_at)}
          {r.exception_customer_note ? `. Your comment: ${r.exception_customer_note}` : "."}
        </p>
      ) : (
        <>
          <div className="field">
            <label>Comment (optional)</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. supplier notified, claim to follow" />
          </div>
          <div className="modal-foot-row">
            <button type="button" className="btn outline" onClick={onClose}>
              Close
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await ackException(r.id, note);
                  qc.invalidateQueries({ queryKey: ["wms"] });
                  toast("Thank you, exception acknowledged");
                  onClose();
                } catch (e) {
                  error(e instanceof Error ? e.message : "Could not save");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Acknowledge
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- Value-added services (0150) ---------- */

export function PortalServices({ receipts, toolsSlot }: { receipts: WmsReceipt[]; toolsSlot: HTMLDivElement | null }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const q = useWmsServices();
  const [creating, setCreating] = useState(false);
  const recNo = new Map(receipts.map((r) => [r.id, r.receipt_no]));
  const rows = q.data ?? [];
  const columns: DataColumn<WmsServiceRequest>[] = [
    { key: "no", header: "Request No", width: 110, render: (x) => <b>{x.service_no}</b>, sortValue: (x) => x.service_no },
    { key: "date", header: "Requested", width: 100, render: (x) => formatDate(x.created_at), sortValue: (x) => x.created_at },
    { key: "service", header: "Service", width: 170, render: (x) => x.service },
    { key: "receipts", header: "Receipts", width: 180, render: (x) => x.receipt_ids.map((id) => recNo.get(id) ?? "?").join(", ") || "—" },
    { key: "qty", header: "Qty", width: 70, render: (x) => (x.qty == null ? "—" : String(x.qty)) },
    { key: "needed", header: "Needed by", width: 100, render: (x) => formatDate(x.required_date) },
    {
      key: "status",
      header: "Status",
      width: 120,
      render: (x) => <span className={`badge ${SERVICE_STATUS[x.status].cls}`}>{SERVICE_STATUS[x.status].label}</span>,
    },
    { key: "charge", header: "Charge (excl. VAT)", width: 140, render: (x) => (x.charge_amount != null ? money(x.charge_amount) : "—") },
    {
      key: "note",
      header: "Notes",
      width: 220,
      render: (x) =>
        x.status === "requested" ? (
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (!confirm(`Cancel ${x.service_no}?`)) return;
              try {
                await cancelService(x.id);
                qc.invalidateQueries({ queryKey: ["wms", "services"] });
                toast("Request cancelled");
              } catch (e) {
                error(e instanceof Error ? e.message : "Could not cancel");
              }
            }}
          >
            Cancel request
          </button>
        ) : (
          x.staff_note || x.notes || "—"
        ),
    },
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Warehouse services</h2>
          <p>Ask for labelling, repacking, palletising, photos, inspection or another service on your goods.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          + Request a service
        </button>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No service requests yet.</EmptyState>
      ) : (
        <DataTable tableKey="portal-wms-services" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(x) => x.id} />
      )}
      {creating && (
        <ServiceModal
          inStore={receipts.filter((r) => r.on_hand > 0)}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ["wms", "services"] });
          }}
        />
      )}
    </div>
  );
}

function ServiceModal({ inStore, onClose, onDone }: { inStore: WmsReceipt[]; onClose: () => void; onDone: () => void }) {
  const { toast, error } = useToast();
  const [service, setService] = useState(SERVICE_TYPES[0]);
  const [other, setOther] = useState("");
  const [qtyV, setQty] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const name = service === "Other" ? other.trim() : service;
    if (!name) return error("Which service do you need?");
    setBusy(true);
    try {
      await requestService({ service: name, qty: qtyV, required_date: date, notes, receipt_ids: ids });
      toast("Service requested, the warehouse team has been notified");
      onDone();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Request a warehouse service" onClose={onClose} wide>
      <div className="grid4">
        <div className="field">
          <label>Service</label>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICE_TYPES.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {service === "Other" ? (
          <div className="field">
            <label>Which service?</label>
            <input value={other} onChange={(e) => setOther(e.target.value)} />
          </div>
        ) : (
          <div className="field">
            <label>Quantity (labels, pallets, cartons…)</label>
            <input type="number" min={0} step="any" value={qtyV} onChange={(e) => setQty(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label>Needed by</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div />
      </div>
      <h4 className="wms-subhead">On which goods?</h4>
      {inStore.length === 0 ? (
        <p className="hint">Nothing of yours is in the Motion Warehouse right now.</p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Receipt</th>
              <th>Description</th>
              <th>In Motion Warehouse</th>
            </tr>
          </thead>
          <tbody>
            {inStore.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={ids.includes(r.id)}
                    onChange={(e) => setIds((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))}
                  />
                </td>
                <td>{r.receipt_no}</td>
                <td>{r.description || "—"}</td>
                <td>{r.on_hand} pcs</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="field">
        <label>Instructions</label>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. label every carton with our PO number, photos of each pallet" />
      </div>
      <p className="hint">ExPac confirms the charge when the service is done; it's added to your storage statement.</p>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={() => void submit()} disabled={busy}>
          {busy ? "Sending…" : "Request service"}
        </button>
      </div>
    </Modal>
  );
}
