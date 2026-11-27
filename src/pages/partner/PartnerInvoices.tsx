/**
 * Partner Portal › Invoices & Statement (0251): submit an invoice per
 * shipment (PDF + number, dates, currency, amounts), see each invoice's
 * status (submitted / approved / queried / paid) next to what ExPac expects
 * from the buy lines, answer queries, and a statement per currency with
 * ageing that prints on ExPac's letterhead.
 */
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Modal from "../../components/Modal";
import DateInput from "../../components/DateInput";
import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { COMPANY } from "../../lib/company";
import { getShipmentDocumentUrl } from "../../lib/db";
import { formatDate } from "../../lib/format";
import { uploadPartnerDocument, usePartnerShipments } from "../../lib/partnerShipments";
import {
  INVOICE_CURRENCIES,
  INVOICE_STATUS_LABEL,
  money,
  replyInvoiceQuery,
  statementByCurrency,
  STATEMENT_BUCKETS,
  submitPartnerInvoice,
  usePartnerInvoiceMutation,
  usePartnerInvoices,
  type PartnerInvoice,
} from "../../lib/partnerInvoices";

const today = () => new Date().toISOString().slice(0, 10);
const plus30 = (iso: string) => new Date(Date.parse(iso) + 30 * 86_400_000).toISOString().slice(0, 10);

function StatusBadge({ s }: { s: PartnerInvoice["status"] }) {
  return <span className={`pi-status is-${s}`}>{INVOICE_STATUS_LABEL[s]}</span>;
}

export default function PartnerInvoices({ company }: { company: string }) {
  const q = usePartnerInvoices();
  const [params, setParams] = useSearchParams();
  const [submitFor, setSubmitFor] = useState<string | null>(params.get("job"));
  const [replyTo, setReplyTo] = useState<PartnerInvoice | null>(null);
  const [printing, setPrinting] = useState(false);
  const { error } = useToast();
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const statement = useMemo(() => statementByCurrency(rows), [rows]);

  async function open(path: string | null) {
    if (!path) return;
    try {
      window.open(await getShipmentDocumentUrl(path), "_blank", "noopener");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the invoice");
    }
  }

  if (printing) return <StatementPrint company={company} rows={rows} onClose={() => setPrinting(false)} />;

  return (
    <>
      <PageHeader
        eyebrow="Billing ExPac"
        title="Invoices & Statement"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn outline" disabled={rows.length === 0} onClick={() => setPrinting(true)}>
              Print statement
            </button>
            <button type="button" className="btn" onClick={() => setSubmitFor("")}>
              + Submit invoice
            </button>
          </div>
        }
      />

      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <>
          {statement.length > 0 && (
            <div className="pi-statement">
              {statement.map((s) => {
                const paidPct = s.invoiced > 0 ? Math.min(100, (s.paid / s.invoiced) * 100) : 0;
                return (
                  <div key={s.currency} className="panel pi-cur pi-stmt">
                    <div className="pi-stmt-label">Outstanding · {s.currency}</div>
                    <div className="pi-stmt-total">{money(s.currency, s.outstanding)}</div>
                    <div className="pi-stmt-paid">
                      <div className="pi-stmt-meter">
                        <span style={{ width: `${paidPct}%` }} />
                      </div>
                      <div className="pi-stmt-figs">
                        <span>
                          Invoiced <b>{money(s.currency, s.invoiced)}</b>
                        </span>
                        <span>
                          Paid <b>{money(s.currency, s.paid)}</b>
                        </span>
                      </div>
                    </div>
                    {s.outstanding > 0 && (
                      <div className="pi-stmt-age">
                        <div className="pi-stmt-bar">
                          {STATEMENT_BUCKETS.map((b, i) =>
                            s.ageing[i] > 0 ? (
                              <span
                                key={b.label}
                                className={`b${i}`}
                                style={{ width: `${(s.ageing[i] / s.outstanding) * 100}%` }}
                                title={`${b.label}: ${money(s.currency, s.ageing[i])}`}
                              />
                            ) : null,
                          )}
                        </div>
                        <ul className="pi-stmt-legend">
                          {STATEMENT_BUCKETS.map((b, i) => (
                            <li key={b.label} className={s.ageing[i] > 0 ? undefined : "zero"}>
                              <i className={`b${i}`} />
                              <span>{b.label}</span>
                              <b>{s.ageing[i] ? money(s.currency, s.ageing[i]) : "–"}</b>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="panel">
            {rows.length === 0 ? (
              <EmptyState>
                No invoices yet. Submit your invoice for each shipment once you've accepted it; ExPac approves it and
                tells you when it's paid.
              </EmptyState>
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
                      <th className="num">ExPac expects</th>
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
                        <td>{i.reference}</td>
                        <td>{formatDate(i.invoice_date)}</td>
                        <td>{i.due_date ? formatDate(i.due_date) : "-"}</td>
                        <td className="num">{money(i.currency, Number(i.total))}</td>
                        <td className="num hint">
                          {Object.entries(i.expected).length
                            ? Object.entries(i.expected)
                                .map(([c, v]) => money(c, Number(v)))
                                .join(" + ")
                            : "-"}
                        </td>
                        <td>
                          <StatusBadge s={i.status} />
                          {i.status === "paid" && (
                            <div className="hint">
                              {formatDate(i.paid_at)}
                              {i.payment_ref ? ` · ${i.payment_ref}` : ""}
                            </div>
                          )}
                          {i.status === "queried" && i.query_note && <div className="pi-query">{i.query_note}</div>}
                        </td>
                        <td>
                          {i.status === "queried" && (
                            <button type="button" className="btn small" onClick={() => setReplyTo(i)}>
                              Answer query
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {submitFor !== null && (
        <SubmitInvoiceModal
          jobId={submitFor}
          onClose={() => {
            setSubmitFor(null);
            if (params.get("job")) {
              const next = new URLSearchParams(params);
              next.delete("job");
              setParams(next, { replace: true });
            }
          }}
        />
      )}
      {replyTo && <ReplyModal inv={replyTo} onClose={() => setReplyTo(null)} />}
    </>
  );
}

function SubmitInvoiceModal({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { toast, error } = useToast();
  const shipsQ = usePartnerShipments();
  const ships = (shipsQ.data ?? []).filter((s) => s.acceptance !== "pending");
  const [job, setJob] = useState(jobId);
  const [no, setNo] = useState("");
  const [date, setDate] = useState(today());
  const [due, setDue] = useState(plus30(today()));
  const [cur, setCur] = useState("USD");
  const [excl, setExcl] = useState("");
  const [vat, setVat] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const total = (Number(excl) || 0) + (Number(vat) || 0);
  const save = usePartnerInvoiceMutation(async () => {
    const docId = file ? await uploadPartnerDocument(job, file, "Supplier Invoice") : null;
    await submitPartnerInvoice({
      jobId: job,
      invoiceNo: no.trim(),
      invoiceDate: date,
      dueDate: due || null,
      currency: cur,
      amountExcl: Number(excl) || 0,
      vat: Number(vat) || 0,
      total,
      documentId: docId,
    });
  });
  const ok = job && no.trim() && date && total > 0 && file;
  return (
    <Modal title="Submit an invoice to ExPac" onClose={onClose}>
      <div className="pi-form">
        <div className="field wide">
          <label>Shipment</label>
          <select value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">Pick a shipment…</option>
            {ships.map((s) => (
              <option key={s.id} value={s.id}>
                {s.reference} · {s.origin ?? "-"} to {s.destination ?? "-"}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Your invoice number</label>
          <input value={no} onChange={(e) => setNo(e.target.value)} />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={cur} onChange={(e) => setCur(e.target.value)}>
            {INVOICE_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Invoice date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div className="field">
          <label>Due date</label>
          <DateInput value={due} onChange={setDue} />
        </div>
        <div className="field">
          <label>Amount excl. VAT / tax</label>
          <input type="number" min="0" step="0.01" value={excl} onChange={(e) => setExcl(e.target.value)} />
        </div>
        <div className="field">
          <label>VAT / tax</label>
          <input type="number" min="0" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} />
        </div>
        <div className="field wide">
          <label>Invoice PDF</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn outline" onClick={() => input.current?.click()}>
              {file ? "Change file" : "Choose file"}
            </button>
            <span className="hint">{file ? file.name : "PDF or image, up to 20 MB"}</span>
            <input
              ref={input}
              type="file"
              hidden
              accept="application/pdf,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (f && f.size > 20 * 1024 * 1024) return error("That file is over 20 MB");
                setFile(f);
              }}
            />
          </div>
        </div>
      </div>
      <p className="pi-total">
        Total <b>{money(cur, total)}</b>
      </p>
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={!ok || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync(undefined);
              toast("Invoice submitted to ExPac");
              onClose();
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not submit the invoice");
            }
          }}
        >
          {save.isPending ? "Submitting…" : "Submit invoice"}
        </button>
      </div>
    </Modal>
  );
}

function ReplyModal({ inv, onClose }: { inv: PartnerInvoice; onClose: () => void }) {
  const { toast, error } = useToast();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = usePartnerInvoiceMutation(async () => {
    const docId = file ? await uploadPartnerDocument(inv.job_id, file, "Supplier Invoice") : null;
    await replyInvoiceQuery(inv.id, note.trim(), docId);
  });
  return (
    <Modal title={`Query on invoice ${inv.invoice_no}`} onClose={onClose}>
      <p className="pi-query" style={{ marginTop: 0 }}>
        <b>ExPac:</b> {inv.query_note}
      </p>
      <div className="field">
        <label>Your answer</label>
        <textarea rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button type="button" className="btn outline" onClick={() => input.current?.click()}>
          {file ? "Change corrected PDF" : "Attach a corrected PDF (optional)"}
        </button>
        <span className="hint">{file?.name}</span>
        <input ref={input} type="file" hidden accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="ps-actions">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={!note.trim() || save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync(undefined);
              toast("Answer sent to ExPac");
              onClose();
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not send your answer");
            }
          }}
        >
          Send answer
        </button>
      </div>
    </Modal>
  );
}

/** The statement on ExPac's letterhead, ready for Print / Save as PDF. */
function StatementPrint({ company, rows, onClose }: { company: string; rows: PartnerInvoice[]; onClose: () => void }) {
  const statement = statementByCurrency(rows);
  return (
    <div className="pp-print">
      <div className="qs-toolbar no-print">
        <button type="button" className="btn outline" onClick={onClose}>
          ← Back to invoices
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <div className="qs-sheet">
        <div className="qs-companyhead">
          <img className="logo" src={COMPANY.logoPrint} alt="ExPac" />
          <div className="qs-companyhead-text">
            <div className="name">
              STATEMENT OF ACCOUNT
              <br />
              {COMPANY.headerName}
            </div>
            <div className="lines">{COMPANY.headerLine1}</div>
            <div className="lines">{COMPANY.headerLine2}</div>
          </div>
        </div>
        <div className="qs-bar">Supplier</div>
        <p style={{ fontSize: 11, margin: "0 0 6px" }}>
          <b>{company}</b> · Statement date {formatDate(today())}
        </p>
        <div className="qs-bar">Summary</div>
        <table className="qs-pk">
          <thead>
            <tr>
              <th>Currency</th>
              <th>Invoiced</th>
              <th>Paid</th>
              <th>Outstanding</th>
              {STATEMENT_BUCKETS.map((b) => (
                <th key={b.label}>{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statement.map((s) => (
              <tr key={s.currency}>
                <td>{s.currency}</td>
                <td>{money("", s.invoiced).trim()}</td>
                <td>{money("", s.paid).trim()}</td>
                <td>
                  <b>{money("", s.outstanding).trim()}</b>
                </td>
                {s.ageing.map((a, i) => (
                  <td key={i}>{a ? money("", a).trim() : "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="qs-bar">Invoices</div>
        <table className="qs-pk">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Shipment</th>
              <th>Date</th>
              <th>Due</th>
              <th>Total</th>
              <th>Status</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>{i.invoice_no}</td>
                <td>{i.reference}</td>
                <td>{formatDate(i.invoice_date)}</td>
                <td>{i.due_date ? formatDate(i.due_date) : "-"}</td>
                <td>{money(i.currency, Number(i.total))}</td>
                <td>{INVOICE_STATUS_LABEL[i.status]}</td>
                <td>{i.status === "paid" ? `${formatDate(i.paid_at)}${i.payment_ref ? ` · ${i.payment_ref}` : ""}` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
