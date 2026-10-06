import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Modal from "../../components/Modal";
import { ErrorNote, Loading, PageHeader } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, money } from "../../lib/format";
import { lineTotal, lineVat, packingTotals, volumetricFactor } from "../../lib/calc";
import type { QuoteLine } from "../../lib/types";
import {
  portalQuoteStatus,
  portalTotals,
  usePortalLines,
  usePortalPacking,
  usePortalQuotes,
  useQuoteDecision,
} from "../../lib/portal";

/** Customer Portal › one quotation: route, cargo, ExPac's charges and totals;
 *  a sent, valid quotation can be accepted (creates the shipment) or declined. */
export default function PortalQuoteViewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const quotesQ = usePortalQuotes();
  const linesQ = usePortalLines(id ? [id] : []);
  const packQ = usePortalPacking(id);
  const decide = useQuoteDecision();
  const { toast, error } = useToast();
  const [confirm, setConfirm] = useState<"accept" | "decline" | null>(null);
  const [reason, setReason] = useState("");

  if (quotesQ.isLoading) return <Loading />;
  if (quotesQ.isError) return <ErrorNote error={quotesQ.error} />;
  const q = quotesQ.data?.find((x) => x.id === id);
  if (!q) return <div className="empty">Quotation not found.</div>;

  const st = portalQuoteStatus(q);
  const lines = linesQ.data ?? [];
  const tot = portalTotals(lines);
  const pack = packingTotals(
    (packQ.data ?? []).map((p) => ({ ...p, cbm: p.cbm ?? "" })),
    volumetricFactor(q.mode),
  );
  const categories = [...new Set(lines.map((l) => l.category))];
  const canDecide = st.label === "Response available";
  const priced = q.status !== "open" && lines.length > 0;

  function submit(accept: boolean) {
    decide.mutate(
      { quoteId: q!.id, accept, reason },
      {
        onSuccess: () => {
          toast(accept ? "Quotation accepted, ExPac is booking your shipment" : "Quotation declined, thank you for letting us know");
          setConfirm(null);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  const info: [string, string][] = [
    ["Mode", q.mode],
    ["Origin", q.origin || "—"],
    ["Destination", q.destination || "—"],
    ["Incoterms", q.incoterms || "—"],
    ["Commodity", q.commodity || "—"],
    ["Your reference", q.customer_reference || "—"],
    ["Cargo ready", formatDate(q.request_ready_date)],
    ["Valid until", formatDate(q.valid_until)],
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quotation"
        title={q.reference}
        actions={
          <>
            <button className="btn outline" onClick={() => navigate("/portal/quotes")}>
              All quotations
            </button>
            {priced && (
              <button className="btn outline" onClick={() => window.print()}>
                Print / PDF
              </button>
            )}
            {canDecide && (
              <>
                <button className="btn outline warn" onClick={() => setConfirm("decline")}>
                  Decline
                </button>
                <button className="btn" onClick={() => setConfirm("accept")}>
                  Accept quotation
                </button>
              </>
            )}
          </>
        }
      />

      <div className="panel pt-quote">
        <div className="pt-quote-head">
          <img src="/Logo.jpg" alt="ExPac" className="pt-quote-logo" />
          <div>
            <span className={`badge ${st.cls}`}>{st.label}</span>
            <div className="hint">
              {q.portal_requested_at ? `Requested ${formatDate(q.portal_requested_at)}` : `Issued ${formatDate(q.created_at)}`}
              {q.portal_decided_at ? ` · ${q.portal_decision === "accepted" ? "Accepted" : "Declined"} ${formatDate(q.portal_decided_at)}` : ""}
            </div>
          </div>
        </div>

        {q.status === "open" && (
          <div className="pt-note">
            Thank you, your request is with the ExPac team. We're pricing it now and it will show here (and in your email) as soon as
            it's ready.
          </div>
        )}
        {q.status === "accepted" && (
          <div className="pt-note ok">Accepted, your shipment is being booked. Follow it under Shipments.</div>
        )}

        <div className="pt-info">
          {info.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>

        {(q.request_pickup || q.request_delivery || q.request_notes) && (
          <div className="pt-info" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <span>Collect from</span>
              <b className="pre">{q.request_pickup || "—"}</b>
            </div>
            <div>
              <span>Deliver to</span>
              <b className="pre">{q.request_delivery || "—"}</b>
            </div>
            <div>
              <span>Notes</span>
              <b className="pre">{q.request_notes || "—"}</b>
            </div>
          </div>
        )}

        {(packQ.data ?? []).length > 0 && (
          <>
            <h3 className="pt-h3">Cargo</h3>
            <table className="table--compact wms-mini">
              <thead>
                <tr>
                  <th>Qty</th>
                  <th>L × W × H (cm)</th>
                  <th>Kg each</th>
                  <th style={{ textAlign: "right" }}>Total kg</th>
                  <th style={{ textAlign: "right" }}>Total CBM</th>
                </tr>
              </thead>
              <tbody>
                {(packQ.data ?? []).map((p) => {
                  const cbm = p.cbm != null ? Number(p.cbm) : (p.length_cm * p.width_cm * p.height_cm) / 1_000_000;
                  return (
                    <tr key={p.id}>
                      <td>{Number(p.qty_ctns)}</td>
                      <td>
                        {Number(p.length_cm)} × {Number(p.width_cm)} × {Number(p.height_cm)}
                      </td>
                      <td>{Number(p.actual_kg)}</td>
                      <td style={{ textAlign: "right" }}>{(p.actual_kg * p.qty_ctns).toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{(cbm * p.qty_ctns).toFixed(3)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>{pack.qty}</td>
                  <td colSpan={2}>Chargeable {pack.chargeable.toFixed(1)} kg</td>
                  <td style={{ textAlign: "right" }}>{pack.totalActual.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{pack.totalCbm.toFixed(3)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        {priced && (
          <>
            <h3 className="pt-h3">Charges (ZAR)</h3>
            <table className="table--compact wms-mini pt-charges">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Unit</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>VAT</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <FragmentRows key={c} title={c} lines={lines.filter((l) => l.category === c) as unknown as QuoteLine[]} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    Total excl. VAT
                  </td>
                  <td style={{ textAlign: "right" }}>{money(tot.net)}</td>
                </tr>
                <tr>
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    VAT
                  </td>
                  <td style={{ textAlign: "right" }}>{money(tot.vat)}</td>
                </tr>
                <tr className="pt-grand">
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    Total incl. VAT
                  </td>
                  <td style={{ textAlign: "right" }}>{money(tot.total)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
        {q.portal_decline_reason && <p className="hint">Your note: {q.portal_decline_reason}</p>}
      </div>

      {confirm && (
        <Modal title={confirm === "accept" ? `Accept ${q.reference}?` : `Decline ${q.reference}?`} onClose={() => setConfirm(null)}>
          {confirm === "accept" ? (
            <p>
              You're accepting <b>{money(tot.total)}</b> (incl. VAT) for {q.mode}, {q.origin || "origin"} → {q.destination || "destination"}.
              ExPac books the shipment and it appears under Shipments.
            </p>
          ) : (
            <div className="field">
              <label>Anything we should know? (optional)</label>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. price, timing, went with another option" />
            </div>
          )}
          <div className="modal-foot-row">
            <button type="button" className="btn outline" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className={`btn${confirm === "decline" ? " warn" : ""}`} disabled={decide.isPending} onClick={() => submit(confirm === "accept")}>
              {decide.isPending ? "Saving…" : confirm === "accept" ? "Accept quotation" : "Decline"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function FragmentRows({ title, lines }: { title: string; lines: QuoteLine[] }) {
  return (
    <>
      <tr className="pt-cat">
        <td colSpan={5}>{title}</td>
      </tr>
      {lines.map((l, i) => (
        <tr key={String(l.id ?? i)}>
          <td>{l.description}</td>
          <td>{l.unit || "—"}</td>
          <td style={{ textAlign: "right" }}>{Number(l.qty)}</td>
          <td style={{ textAlign: "right" }}>{lineVat(l) ? money(lineVat(l)) : "—"}</td>
          <td style={{ textAlign: "right" }}>{money(lineTotal(l))}</td>
        </tr>
      ))}
    </>
  );
}
