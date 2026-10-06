import { useMemo, useState } from "react";
import { PageHeader } from "../../components/common";
import { useMyJobs } from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import { DELIVERED_STATUS } from "../../lib/types";
import { WMS_STAGE_LABEL, portalQuoteStatus, portalTotals, usePortalLines, usePortalQuotes, wmsStage } from "../../lib/portal";
import { downloadCsv, todayIso, useWmsBillingRuns, useWmsReceipts, useWmsReleases, useWmsServices } from "../../lib/wms";
import { useWmsJourney } from "./PortalWmsOverview";

const MODES = ["Air", "Sea", "Road", "Courier"] as const;
const COLORS: Record<string, string> = { Air: "var(--teal)", Sea: "var(--blue)", Road: "var(--amber)", Courier: "var(--green)" };
const modeKey = (m: string) => (m.startsWith("Air") ? "Air" : m.startsWith("Sea") ? "Sea" : m.startsWith("Road") ? "Road" : "Courier");
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });

/** Customer Portal › Reports: shipment volumes, freight spend, Motion
 *  Warehouse receipts and storage / services spend by month, deliveries with
 *  proof of delivery, plus CSV downloads of each. */
export default function PortalReportsPage() {
  const jobsQ = useMyJobs();
  const quotesQ = usePortalQuotes();
  const won = (quotesQ.data ?? []).filter((q) => q.status === "accepted" || q.status === "completed");
  const linesQ = usePortalLines(won.map((q) => q.id));
  const [months, setMonths] = useState(12);
  const receiptsQ = useWmsReceipts();
  const releasesQ = useWmsReleases();
  const runsQ = useWmsBillingRuns();
  const svcQ = useWmsServices();
  const journey = useWmsJourney();

  const keys = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    d.setDate(1);
    for (let i = months - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
    }
    return out;
  }, [months]);

  const jobs = jobsQ.data ?? [];
  const shipSeries = keys.map((k) => {
    const inMonth = jobs.filter((j) => monthKey(j.created_at) === k);
    return { k, by: Object.fromEntries(MODES.map((m) => [m, inMonth.filter((j) => modeKey(j.mode) === m).length])) as Record<string, number> };
  });
  const totalByQuote = useMemo(() => {
    const m = new Map<string, { net: number; vat: number; total: number }>();
    const by = new Map<string, NonNullable<typeof linesQ.data>>();
    for (const l of linesQ.data ?? []) by.set(l.quote_id, [...(by.get(l.quote_id) ?? []), l]);
    for (const [id, ls] of by) m.set(id, portalTotals(ls));
    return m;
  }, [linesQ.data]);
  const spendSeries = keys.map((k) => ({
    k,
    v: won.filter((q) => monthKey(q.accepted_at ?? q.created_at) === k).reduce((s, q) => s + (totalByQuote.get(q.id)?.total ?? 0), 0),
  }));
  const receipts = receiptsQ.data ?? [];
  const receiptSeries = keys.map((k) => ({ k, v: receipts.filter((r) => monthKey(r.received_at) === k).length }));
  const maxReceipts = Math.max(1, ...receiptSeries.map((s) => s.v));
  // Storage statements by period month: storage / handling vs value-added services.
  const runs = runsQ.data ?? [];
  const storageSeries = keys.map((k) => {
    const inMonth = runs.filter((r) => monthKey(r.period_to) === k);
    let storage = 0;
    let services = 0;
    for (const r of inMonth)
      for (const l of r.lines ?? []) {
        if (l.kind === "service") services += Number(l.amount) || 0;
        else storage += Number(l.amount) || 0;
      }
    return { k, storage, services };
  });
  const maxStorage = Math.max(1, ...storageSeries.map((s) => s.storage + s.services));
  const deliveredJobs = jobs.filter((j) => j.shipment_status === DELIVERED_STATUS || j.milestone === "Delivered");
  const maxShip = Math.max(1, ...shipSeries.map((s) => MODES.reduce((t, m) => t + s.by[m], 0)));
  const maxSpend = Math.max(1, ...spendSeries.map((s) => s.v));

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Reports"
        actions={
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: "auto" }}>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
            <option value={24}>Last 24 months</option>
          </select>
        }
      />
      <div className="pt-dash-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="panel">
          <div className="panel-head">
            <h2>🚚 Shipments per month</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(`shipments-${todayIso()}.csv`, ["Shipment", "REF", "Mode", "Status", "Origin", "Destination", "AWB / B/L", "Container", "Shipping Line", "Vessel", "Airline", "ETD", "ETA", "Delivered", "Signed for by", "Created"], jobs.map((j) => [j.reference, j.po_no, j.mode, j.shipment_status || j.milestone, j.origin, j.destination, j.awb_mbl, j.container_no, j.shipping_line, j.vessel_name, j.carrier_name, formatDate(j.etd), formatDate(j.eta), formatDate(j.pod_delivered_at), j.pod_signed_by, formatDate(j.created_at)]))
              }
            >
              Download CSV
            </button>
          </div>
          <div className="pt-bars">
            {shipSeries.map((s) => (
              <div key={s.k} className="pt-bar-col" title={`${monthLabel(s.k)}: ${MODES.map((m) => `${s.by[m]} ${m}`).join(", ")}`}>
                <div className="pt-bar-stack" style={{ height: `${(MODES.reduce((t, m) => t + s.by[m], 0) / maxShip) * 100}%` }}>
                  {MODES.filter((m) => s.by[m]).map((m) => (
                    <div key={m} style={{ flex: s.by[m], background: COLORS[m] }} />
                  ))}
                </div>
                <span>{monthLabel(s.k)}</span>
              </div>
            ))}
          </div>
          <div className="pt-legend" style={{ flexDirection: "row", gap: 14 }}>
            {MODES.map((m) => (
              <span key={m}>
                <i style={{ background: COLORS[m] }} />
                {m}
              </span>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>💰 Freight spend (accepted quotations, incl. VAT)</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(`quotations-${todayIso()}.csv`, ["Quotation", "Status", "Mode", "Origin", "Destination", "Commodity", "Ref", "TTL (excl. VAT)", "TTL (VAT)", "TTL (incl. VAT)", "Date", "Valid until"], (quotesQ.data ?? []).map((q) => { const t = totalByQuote.get(q.id); return [q.reference, portalQuoteStatus(q).label, q.mode, q.origin, q.destination, q.commodity, q.customer_reference, t ? t.net.toFixed(2) : "", t ? t.vat.toFixed(2) : "", t ? t.total.toFixed(2) : "", formatDate(q.created_at), formatDate(q.valid_until)]; }))
              }
            >
              Download CSV
            </button>
          </div>
          <div className="pt-bars">
            {spendSeries.map((s) => (
              <div key={s.k} className="pt-bar-col" title={`${monthLabel(s.k)}: ${money(s.v)}`}>
                <div className="pt-bar-stack" style={{ height: `${(s.v / maxSpend) * 100}%` }}>
                  <div style={{ flex: 1, background: "var(--green)" }} />
                </div>
                <span>{monthLabel(s.k)}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            {money(spendSeries.reduce((t, s) => t + s.v, 0))} over the period · {jobs.filter((j) => j.shipment_status === DELIVERED_STATUS).length} shipments delivered
            to date
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>🏭 Motion Warehouse receipts per month</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(
                  `warehouse-receipts-${todayIso()}.csv`,
                  ["Receipt", "Received", "Description", "Your reference", "Pieces", "In Motion Warehouse", "Kg", "CBM", "Condition", "Stage", "Where", "Shipment"],
                  receipts.map((r) => {
                    const t = journey.tracker.get(r.id);
                    return [r.receipt_no, formatDate(r.received_at), r.description, r.customer_reference, r.pieces, r.on_hand, r.gross_kg, r.volume_cbm, r.condition, WMS_STAGE_LABEL[wmsStage(r, t)], r.on_hand > 0 ? journey.whereOf(r) : "", t?.shipment_ref];
                  }),
                )
              }
            >
              Download CSV
            </button>
          </div>
          <div className="pt-bars">
            {receiptSeries.map((s) => (
              <div key={s.k} className="pt-bar-col" title={`${monthLabel(s.k)}: ${s.v} receipts`}>
                <div className="pt-bar-stack" style={{ height: `${(s.v / maxReceipts) * 100}%` }}>
                  <div style={{ flex: 1, background: "var(--teal)" }} />
                </div>
                <span>{monthLabel(s.k)}</span>
              </div>
            ))}
          </div>
          <p className="hint">
            {receipts.filter((r) => r.on_hand > 0).length} receipts in Motion Warehouse now · {(releasesQ.data ?? []).length} releases to date
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>📦 Storage and services (excl. VAT)</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(
                  `storage-statements-${todayIso()}.csv`,
                  ["Statement", "Period from", "Period to", "Receipt", "Description", "Type", "Code", "Qty", "Unit", "Rate", "Amount", "Invoice no"],
                  runs.flatMap((r) => (r.lines ?? []).map((l) => [r.run_no, formatDate(r.period_from), formatDate(r.period_to), l.receipt_no, l.description, l.kind, l.code, l.qty, l.unit, l.rate, l.amount, r.invoice_no])),
                )
              }
            >
              Download CSV
            </button>
          </div>
          <div className="pt-bars">
            {storageSeries.map((s) => (
              <div key={s.k} className="pt-bar-col" title={`${monthLabel(s.k)}: storage ${money(s.storage)}, services ${money(s.services)}`}>
                <div className="pt-bar-stack" style={{ height: `${((s.storage + s.services) / maxStorage) * 100}%` }}>
                  {s.services > 0 && <div style={{ flex: s.services, background: "var(--amber)" }} />}
                  {s.storage > 0 && <div style={{ flex: s.storage, background: "var(--teal)" }} />}
                </div>
                <span>{monthLabel(s.k)}</span>
              </div>
            ))}
          </div>
          <div className="pt-legend" style={{ flexDirection: "row", gap: 14 }}>
            <span>
              <i style={{ background: "var(--teal)" }} />
              Storage and handling
            </span>
            <span>
              <i style={{ background: "var(--amber)" }} />
              Services
            </span>
          </div>
          <p className="hint">
            {money(storageSeries.reduce((t, s) => t + s.storage + s.services, 0))} over the period · {(svcQ.data ?? []).filter((s) => s.status === "done").length} services
            completed to date
          </p>
        </div>

        <div className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-head">
            <h2>✅ Deliveries and proof of delivery</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(
                  `deliveries-${todayIso()}.csv`,
                  ["Type", "Number", "REF", "Mode / delivery", "Destination", "Delivered", "Signed for by"],
                  [
                    ...deliveredJobs.map((j) => ["Shipment", j.reference, j.po_no, j.mode, j.destination, formatDate(j.pod_delivered_at), j.pod_signed_by]),
                    ...(releasesQ.data ?? []).map((r) => ["Warehouse release", r.release_no, r.outbound_ref, r.deliver_to ? "Delivered" : "Collected", r.deliver_to, formatDate(r.pod_delivered_at ?? r.released_at), r.pod_signed_by ?? r.collected_by]),
                  ],
                )
              }
            >
              Download CSV
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {deliveredJobs.length} shipments delivered, {deliveredJobs.filter((j) => j.pod_delivered_at || j.pod_signed_by).length} with a signed proof of delivery ·{" "}
            {(releasesQ.data ?? []).length} warehouse releases, {(releasesQ.data ?? []).filter((r) => r.pod_path).length} with a signed proof of delivery or collection.
          </p>
        </div>
      </div>
    </>
  );
}
