// Vendor record › Invoices (0251): the invoices this partner submitted on
// the partner portal. Staff approve them, query them (the partner answers
// on the portal) or mark them paid; each action messages the partner on the
// shipment. The totals per currency are the partner's statement.
import { useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { getShipmentDocumentUrl } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type { PartnerKind } from "../../lib/types";
import {
  INVOICE_STATUS_LABEL,
  money,
  statementByCurrency,
  useStaffInvoiceAction,
  useStaffPartnerInvoices,
  type PartnerInvoice,
} from "../../lib/partnerInvoices";

export default function PartnerInvoicesStaff({ kind, partnerId }: { kind: PartnerKind; partnerId: string }) {
  const q = useStaffPartnerInvoices(kind, partnerId);
  const act = useStaffInvoiceAction();
  const { toast, error } = useToast();
  const [querying, setQuerying] = useState<PartnerInvoice | null>(null);
  const [paying, setPaying] = useState<PartnerInvoice | null>(null);
  const rows = q.data ?? [];

  async function open(path: string | null) {
    if (!path) return;
    try {
      window.open(await getShipmentDocumentUrl(path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the invoice");
    }
  }

  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <div className="panel">
        <ErrorNote error={q.error} />
        <p className="hint">Partner invoices need migration 0251 in Supabase.</p>
      </div>
    );

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Invoices from the partner portal</h3>
      {rows.length > 0 && (
        <div className="pi-statement" style={{ marginBottom: 12 }}>
          {statementByCurrency(rows).map((s) => (
            <div key={s.currency} className="pi-cur pi-cur-flat">
              <div className="pi-cur-head">
                <span>{s.currency}</span>
                <b>{money(s.currency, s.outstanding)}</b>
                <span className="hint">outstanding</span>
              </div>
              <div className="pi-cur-row">
                <span>Invoiced</span>
                <b>{money(s.currency, s.invoiced)}</b>
              </div>
              <div className="pi-cur-row">
                <span>Paid</span>
                <b>{money(s.currency, s.paid)}</b>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState>No invoices submitted on the partner portal yet.</EmptyState>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="customs-table pi-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Shipment</th>
                <th>Date</th>
                <th>Due</th>
                <th className="num">Total</th>
                <th className="num">Expected (buy)</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.document_path ? (
                      <button type="button" className="ref-link" onClick={() => open(i.document_path)}>
                        {i.invoice_no}
                      </button>
                    ) : (
                      <b>{i.invoice_no}</b>
                    )}
                  </td>
                  <td>
                    <Link to={`/jobs/${i.job_id}`}>{i.reference}</Link>
                  </td>
                  <td>{formatDate(i.invoice_date)}</td>
                  <td>{i.due_date ? formatDate(i.due_date) : "-"}</td>
                  <td className="num">{money(i.currency, Number(i.total))}</td>
                  <td className="num hint">
                    {Object.entries(i.expected)
                      .map(([c, v]) => money(c, Number(v)))
                      .join(" + ") || "-"}
                  </td>
                  <td>
                    <span className={`pi-status is-${i.status}`}>{INVOICE_STATUS_LABEL[i.status]}</span>
                    {i.status === "queried" && i.query_note && <div className="pi-query">{i.query_note}</div>}
                    {i.reply_note && i.status === "submitted" && <div className="hint">Partner: {i.reply_note}</div>}
                    {i.status === "paid" && (
                      <div className="hint">
                        {formatDate(i.paid_at)}
                        {i.payment_ref ? ` · ${i.payment_ref}` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {i.status !== "paid" && (
                      <>
                        {i.status !== "approved" && (
                          <button
                            type="button"
                            className="btn small outline"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate(
                                { id: i.id, action: "approve" },
                                { onSuccess: () => toast("Approved, partner told"), onError: (e) => error(e.message) },
                              )
                            }
                          >
                            Approve
                          </button>
                        )}{" "}
                        <button type="button" className="btn small outline" onClick={() => setQuerying(i)}>
                          Query
                        </button>{" "}
                        <button type="button" className="btn small" onClick={() => setPaying(i)}>
                          Mark paid
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {querying && <QueryModal inv={querying} onClose={() => setQuerying(null)} />}
      {paying && <PaidModal inv={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

function QueryModal({ inv, onClose }: { inv: PartnerInvoice; onClose: () => void }) {
  const act = useStaffInvoiceAction();
  const { toast, error } = useToast();
  const [note, setNote] = useState("");
  return (
    <Modal title={`Query invoice ${inv.invoice_no}`} onClose={onClose}>
      <div className="field">
        <label>What needs fixing (the partner sees this)</label>
        <textarea rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={!note.trim() || act.isPending}
          onClick={() =>
            act.mutate(
              { id: inv.id, action: "query", note: note.trim() },
              {
                onSuccess: () => {
                  toast("Query sent to the partner");
                  onClose();
                },
                onError: (e) => error(e.message),
              },
            )
          }
        >
          Send query
        </button>
      </div>
    </Modal>
  );
}

function PaidModal({ inv, onClose }: { inv: PartnerInvoice; onClose: () => void }) {
  const act = useStaffInvoiceAction();
  const { toast, error } = useToast();
  const [amount, setAmount] = useState(String(inv.total));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");
  return (
    <Modal title={`Mark ${inv.invoice_no} paid`} onClose={onClose}>
      <div className="field">
        <label>Amount paid ({inv.currency})</label>
        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label>Paid on</label>
        <DateInput value={date} onChange={setDate} />
      </div>
      <div className="field">
        <label>Payment reference</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. bank transfer reference" />
      </div>
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={!(Number(amount) > 0) || act.isPending}
          onClick={() =>
            act.mutate(
              { id: inv.id, action: "paid", amount: Number(amount), paidAt: date, ref: ref.trim() },
              {
                onSuccess: () => {
                  toast("Marked paid, partner told");
                  onClose();
                },
                onError: (e) => error(e.message),
              },
            )
          }
        >
          Mark paid
        </button>
      </div>
    </Modal>
  );
}
