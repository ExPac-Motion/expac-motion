import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import { Loading, StatusBadge } from "../components/common";
import { useToast } from "../components/Toast";
import { useAcceptQuote, useDeleteQuote, useQuote } from "../lib/hooks";
import {
  chargeTotals,
  fxOf,
  groupByCategory,
  lineTotal,
  lineTotalIncl,
  lineVatPct,
  packingRow,
  packingTotals,
  resolveLine,
  sellInCur,
} from "../lib/calc";
import { formatDate, money, usd } from "../lib/format";

interface Props {
  quoteId: string;
  onClose: () => void;
}

export default function QuoteDetailModal({ quoteId, onClose }: Props) {
  const navigate = useNavigate();
  const { toast, error } = useToast();
  const { data: q, isLoading } = useQuote(quoteId);
  const del = useDeleteQuote();
  const accept = useAcceptQuote();

  if (isLoading || !q) {
    return (
      <Modal title="Quotation" onClose={onClose} wide>
        <Loading />
      </Modal>
    );
  }

  const packing = q.packing_list_items ?? [];
  const packTotals = packingTotals(packing);
  const resolvedLines = q.quote_lines.map((l) =>
    resolveLine(l, {
      mode: q.mode,
      fx: fxOf(q),
      pack: packTotals,
      commercialValue: q.commercial_value ?? "",
    }),
  );
  const t = chargeTotals(resolvedLines, fxOf(q));
  const groups = groupByCategory(resolvedLines);

  async function onDelete() {
    if (!q) return;
    if (!window.confirm(`Delete ${q.reference}? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(q.id);
      toast("Quote deleted");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  async function onAccept() {
    if (!q) return;
    try {
      await accept.mutateAsync(q.id);
      toast("Shipment created — check Active Shipments");
      onClose();
      navigate("/jobs");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not accept quote");
    }
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
          <button
            className="btn outline"
            onClick={() => {
              onClose();
              navigate(`/quotes/${q.id}/print`);
            }}
          >
            Quotation document
          </button>
          <button
            className="btn outline"
            onClick={() => {
              onClose();
              navigate(`/quotes/${q.id}`);
            }}
          >
            Edit quote
          </button>
          <button className="btn danger" onClick={onDelete} disabled={del.isPending}>
            Delete
          </button>
          {q.status !== "accepted" ? (
            <button className="btn" onClick={onAccept} disabled={accept.isPending}>
              {accept.isPending ? "Working…" : "Accept & create shipment"}
            </button>
          ) : (
            <span className="btn status">Shipment created</span>
          )}
        </>
      }
      belowHeader={
        <p className="muted" style={{ margin: "6px 0 0" }}>
          {q.mode}: {q.origin || "—"} → {q.destination || "—"}
        </p>
      }
    >
      <div className="grid4" style={{ margin: "4px 0 14px" }}>
        <Field label="Customer/Importer" value={q.client?.company ?? "—"} />
        <Field label="Shipper/Exporter" value={q.supplier?.company ?? "—"} />
        <Field label="Agent (internal)" value={q.agent?.company ?? "—"} />
        <Field
          label="Transporter (internal)"
          value={q.transporter?.company ?? "—"}
        />
        <Field
          label="Clearing Agent (internal)"
          value={q.clearing_agent?.company ?? "—"}
        />
        <Field label="Reference" value={q.reference} />
        <Field label="Valid Until" value={formatDate(q.valid_until)} />
        <Field label="Commercial Value ($)" value={usd(q.commercial_value)} />
        <Field label="Incoterms" value={q.incoterms || "—"} />
        <Field label="Insurance Amount ($)" value={usd(q.insurance_amount)} />
        <Field label="Commodity" value={q.commodity || "—"} />
        <Field label="Mode" value={q.mode} />
        <Field label="Delivery terms" value={q.delivery_terms || "—"} />
        <Field label="Origin/Port of Load" value={q.origin || "—"} />
        <Field label="Destination/Port of Discharge" value={q.destination || "—"} />
        <Field label="Vessel Name" value={q.vessel_name || "—"} />
        <Field label="MBL No" value={q.mbl_no || "—"} />
        <Field label="HBL No" value={q.hbl_no || "—"} />
        <Field label="Container Number" value={q.container_no || "—"} />
        <Field label="ETD" value={formatDate(q.etd)} />
        <Field label="ETA" value={formatDate(q.eta)} />
        <Field label="MAWB No" value={q.mawb_no || "—"} />
        <Field label="HAWB No" value={q.hawb_no || "—"} />
        <Field label="Flight No" value={q.flight_no || "—"} />
        <Field label="Flight Date" value={formatDate(q.flight_date)} />
        <Field label="Carrier/Airline Name" value={q.carrier_name || "—"} />
        <div>
          <div className="hint" style={{ marginBottom: 4 }}>
            Status
          </div>
          <StatusBadge status={q.status} />
        </div>
      </div>

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
                  const r = packingRow(p);
                  return (
                    <tr key={p.id ?? i}>
                      <td style={{ textAlign: "right" }}>{Number(p.length_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>{Number(p.width_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>{Number(p.height_cm) || 0}</td>
                      <td style={{ textAlign: "right" }}>
                        {(Number(p.actual_kg) || 0).toFixed(2)}
                      </td>
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
                    Chargeable Volume (CBM)
                  </td>
                  <td colSpan={2} style={{ textAlign: "right", fontWeight: 700 }}>
                    {packTotals.totalCbm.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={7} style={{ textAlign: "right" }} className="muted">
                    Chargeable Weight (KGS) — max(actual{" "}
                    {packTotals.totalActual.toFixed(2)}, volume{" "}
                    {packTotals.totalVolume.toFixed(2)})
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

      {q.quote_lines.length === 0 ? (
        <p className="muted">No charge lines.</p>
      ) : (
        groups
          .filter((g) => g.lines.length > 0)
          .map((g) => (
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
                      <th>Cur</th>
                      <th>Unit</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Buy</th>
                      <th style={{ textAlign: "right" }}>Margin %</th>
                      <th style={{ textAlign: "right" }}>VAT %</th>
                      <th style={{ textAlign: "right" }}>Sell ($)</th>
                      <th style={{ textAlign: "right" }}>Sell (R)</th>
                      <th style={{ textAlign: "right" }}>Line total (R)</th>
                      <th style={{ textAlign: "right" }}>Incl. VAT (R)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.lines.map(({ line: l, index: i }) => (
                      <tr key={l.id ?? i}>
                        <td>{l.code || "—"}</td>
                        <td>{l.description || "—"}</td>
                        <td>{l.cur}</td>
                        <td>{l.unit || "—"}</td>
                        <td style={{ textAlign: "right" }}>{Number(l.qty) || 0}</td>
                        <td style={{ textAlign: "right" }}>
                          {l.cur} {(Number(l.buy) || 0).toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {(Number(l.margin) || 0).toFixed(1)}%
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {lineVatPct(l).toFixed(1)}%
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {l.cur} {sellInCur(l.buy, l.margin).toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right" }}>{money(l.sell)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>
                          {money(lineTotal(l))}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>
                          {money(lineTotalIncl(l))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={10} style={{ textAlign: "right" }} className="muted">
                        Section subtotal{g.vat > 0 ? " (excl. VAT · incl. VAT)" : ""}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {money(g.subtotal)}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>
                        {money(g.subtotalIncl)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))
      )}

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
          <div style={{ fontSize: ".75rem", color: "#b8beb8" }}>
            Total quotation (incl. VAT)
          </div>
          <div style={{ fontSize: ".75rem", color: "#b8beb8" }}>
            Excl. VAT: {money(t.sell)} · VAT: {money(t.vat)}
          </div>
          <div style={{ fontSize: ".75rem", color: "#b8beb8" }}>
            Cost (ZAR): {money(t.cost)} · GP: {money(t.gp)} · Margin:{" "}
            {t.margin.toFixed(1)}%
          </div>
          <div style={{ fontSize: ".7rem", color: "#8a918a" }}>
            FX: USD {Number(q.fx_usd_zar).toFixed(2)} · CNY{" "}
            {Number(q.fx_cny_zar).toFixed(2)}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--display)",
            fontSize: "1.5rem",
            fontWeight: 800,
            color: "var(--green)",
          }}
        >
          {money(t.sellIncl)}
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hint" style={{ marginBottom: 4 }}>
        {label}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
