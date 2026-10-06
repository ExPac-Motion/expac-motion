import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { currencyAmount, formatDate, money } from "../../lib/format";
import { groupByCategory, lineNet, lineTotalIncl, lineVatPct, packingRow, packingTotals, volumetricFactor } from "../../lib/calc";
import type { PackingItem, QuoteLine } from "../../lib/types";
import { portalQuoteStatus, portalTotals, usePortalLines, usePortalMe, usePortalPacking, usePortalQuotes, useQuoteDecision } from "../../lib/portal";

/**
 * Customer Portal › Quotations › one quotation, the same view as Motion's
 * quotation detail (QuoteDetailModal) without anything internal: no buy cost,
 * margin, FX, agents / transporter, notes, edit or delete. A sent, valid
 * quotation can be accepted (creates the shipment) or declined.
 */
export default function PortalQuoteModal({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const quotesQ = usePortalQuotes();
  const linesQ = usePortalLines([quoteId]);
  const packQ = usePortalPacking(quoteId);
  const meQ = usePortalMe();
  const decide = useQuoteDecision();
  const { toast, error } = useToast();
  const [confirm, setConfirm] = useState<"accept" | "decline" | null>(null);
  const [reason, setReason] = useState("");

  const q = quotesQ.data?.find((x) => x.id === quoteId);
  if (quotesQ.isLoading || linesQ.isLoading || packQ.isLoading) {
    return (
      <Modal title="Quotation" onClose={onClose} wide>
        <Loading />
      </Modal>
    );
  }
  if (!q) {
    return (
      <Modal title="Quotation" onClose={onClose}>
        <p className="muted">Quotation not found.</p>
      </Modal>
    );
  }

  const st = portalQuoteStatus(q);
  const lines = (linesQ.data ?? []).map((l) => ({ ...l, code: l.code ?? "", unit: l.unit ?? "", buy: 0, margin: 0 }) as QuoteLine);
  const tot = portalTotals(linesQ.data ?? []);
  const groups = groupByCategory(lines).filter((g) => g.lines.length > 0);
  const packing: PackingItem[] = (packQ.data ?? []).map((p) => ({ ...p, cbm: p.cbm ?? "" }));
  const vFactor = volumetricFactor(q.mode);
  const packTotals = packingTotals(packing, vFactor);
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

  return (
    <Modal
      title={q.reference}
      onClose={onClose}
      wide
      stickyHeader
      headerActions={
        <>
          <button className="btn outline" onClick={onClose}>
            Close
          </button>
          {priced && (
            <button className="btn outline" onClick={() => navigate(`/portal/quotes/${q.id}/print`)}>
              Quotation document
            </button>
          )}
          {canDecide ? (
            <>
              <button className="btn outline warn" onClick={() => setConfirm("decline")}>
                Decline
              </button>
              <button className="btn" onClick={() => setConfirm("accept")}>
                Accept quotation
              </button>
            </>
          ) : (
            <span className={`badge ${st.cls}`}>{st.label}</span>
          )}
        </>
      }
      belowHeader={
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {q.mode}: {q.origin || "—"} → {q.destination || "—"}
        </p>
      }
    >
      {q.status === "open" && (
        <div className="pt-note">
          Thank you, your request is with the ExPac team. We're pricing it now and it will show here (and in your email) as soon as it's
          ready.
        </div>
      )}
      {q.status === "accepted" && <div className="pt-note ok">Accepted, your shipment is being booked. Follow it under Shipments.</div>}

      <div className="grid4" style={{ margin: "4px 0 14px" }}>
        <Field label="Shipment No" value={q.reference} />
        <Field label="Mode" value={q.mode} />
        <Field label="Incoterms" value={q.incoterms || "—"} />
        <div>
          <div className="qd-label" style={{ marginBottom: 4 }}>
            Status
          </div>
          <span className={`badge ${st.cls}`}>{st.label}</span>
        </div>

        <Field label="Customer/Importer" value={meQ.data?.company ?? "—"} />
        <Field label="Reference" value={q.customer_reference || "—"} />
        <Field label="Shipper/Exporter" value={q.supplier_company ?? "—"} />
        <Field label="Delivery terms" value={q.delivery_terms || "—"} />

        <Field label="Commercial Value" value={currencyAmount(q.commercial_value, q.value_currency as never)} />
        <Field label="Insurance Amount" value={currencyAmount(q.insurance_amount, q.value_currency as never)} />
        <Field label="Commodity" value={q.commodity || "—"} />
        <Field label="Valid Until" value={formatDate(q.valid_until)} />

        <Field label="Origin/Port of Load" value={q.origin || "—"} />
        <Field label="Destination/Port of Discharge" value={q.destination || "—"} />
        <Field label="ETD" value={formatDate(q.etd)} />
        <Field label="ETA" value={formatDate(q.eta)} />

        <Field label="Vessel Name" value={q.vessel_name || "—"} />
        <Field label="Container Number" value={q.container_no || "—"} />
        <Field label="MBL No" value={q.mbl_no || "—"} />
        <Field label="HBL No" value={q.hbl_no || "—"} />

        <Field label="MAWB No" value={q.mawb_no || "—"} />
        <Field label="HAWB No" value={q.hawb_no || "—"} />
        <Field label="Flight No" value={q.flight_no || "—"} />
        <Field label="Flight Date" value={formatDate(q.flight_date)} />

        <Field label="Airline Name" value={q.carrier_name || "—"} />
        {q.portal_requested_at && <Field label="Cargo ready" value={formatDate(q.request_ready_date)} />}
      </div>

      {(q.request_pickup || q.request_delivery || q.request_notes) && (
        <div className="grid3" style={{ margin: "0 0 14px" }}>
          <Field label="Collect from" value={q.request_pickup || "—"} />
          <Field label="Deliver to" value={q.request_delivery || "—"} />
          <Field label="Your notes" value={q.request_notes || "—"} />
        </div>
      )}

      {packing.length > 0 && (
        <div className="charge-group">
          <div className="charge-group-head">
            <h3>PACKING LIST INFORMATION</h3>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "right" }}>L</th>
                  <th style={{ textAlign: "right" }}>W</th>
                  <th style={{ textAlign: "right" }}>H</th>
                  <th style={{ textAlign: "right" }}>Actual (KGS)</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>CBM</th>
                  <th style={{ textAlign: "right" }}>Volume (KGS)</th>
                  <th style={{ textAlign: "right" }}>Total Act</th>
                  <th style={{ textAlign: "right" }}>Total Vol</th>
                </tr>
              </thead>
              <tbody>
                {packing.map((p, i) => {
                  const r = packingRow(p, vFactor);
                  return (
                    <tr key={p.id ?? i}>
                      <td style={{ textAlign: "right" }}>{Number(p.length_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>{Number(p.width_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>{Number(p.height_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>{(Number(p.actual_kg) || 0).toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{Number(p.qty_ctns) || 0}</td>
                      <td style={{ textAlign: "right" }}>{r.cbm.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{r.volumeKg.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{r.totalActual.toFixed(2)}</td>
                      <td style={{ textAlign: "right" }}>{r.totalVolume.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ textAlign: "right" }} className="muted">
                    Chg Vol (CBM)
                  </td>
                  <td colSpan={2} style={{ textAlign: "right", fontWeight: 700 }}>
                    {packTotals.totalCbm.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={7} style={{ textAlign: "right" }} className="muted">
                    Chg Weight (KGS), max(actual {packTotals.totalActual.toFixed(2)}, volume {packTotals.totalVolume.toFixed(2)})
                  </td>
                  <td colSpan={2} style={{ textAlign: "right", fontWeight: 700 }}>
                    {packTotals.chargeable.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {priced &&
        groups.map((g) => (
          <div className="charge-group" key={g.category}>
            <div className="charge-group-head">
              <h3>{g.category.toUpperCase()}</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Unit</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>VAT %</th>
                    <th style={{ textAlign: "right" }}>Rate (R)</th>
                    <th style={{ textAlign: "right" }}>Line total (R)</th>
                    <th style={{ textAlign: "right" }}>Incl. VAT (R)</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map(({ line: l, index: i }) => (
                    <tr key={l.id ?? i}>
                      <td>{l.code || "—"}</td>
                      <td>{l.description || "—"}</td>
                      <td>{l.unit || "—"}</td>
                      <td style={{ textAlign: "right" }}>{Number(l.qty) || 0}</td>
                      <td style={{ textAlign: "right" }}>{lineVatPct(l).toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}>{money(l.sell)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(lineNet(l))}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{money(lineTotalIncl(l))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: "right" }} className="muted">
                      Section subtotal{g.vat > 0 ? " (excl. VAT · incl. VAT)" : ""}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{money(g.subtotal)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{money(g.subtotalIncl)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}

      {priced && (
        <div
          style={{
            background: "var(--ink)",
            color: "#fff",
            borderRadius: 12,
            padding: "16px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
          }}
        >
          <div>
            <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>Total quotation (incl. VAT)</div>
            <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              Excl. VAT: {money(tot.net)} · VAT: {money(tot.vat)}
            </div>
          </div>
          <div style={{ fontFamily: "var(--display)", fontSize: "1.5rem", fontWeight: 700, color: "var(--green)" }}>{money(tot.total)}</div>
        </div>
      )}
      {q.portal_decline_reason && <p className="hint">Your note: {q.portal_decline_reason}</p>}

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
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="qd-label" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <div className="pre">{value}</div>
    </div>
  );
}
