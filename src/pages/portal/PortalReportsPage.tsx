import { useMemo, useState } from "react";
import { PageHeader } from "../../components/common";
import { useMyJobs } from "../../lib/hooks";
import { formatDate, money } from "../../lib/format";
import { DELIVERED_STATUS } from "../../lib/types";
import { portalQuoteStatus, portalTotals, usePortalLines, usePortalQuotes } from "../../lib/portal";
import { downloadCsv, todayIso } from "../../lib/wms";

const MODES = ["Air", "Sea", "Road", "Courier"] as const;
const COLORS: Record<string, string> = { Air: "var(--teal)", Sea: "var(--blue)", Road: "var(--amber)", Courier: "var(--green)" };
const modeKey = (m: string) => (m.startsWith("Air") ? "Air" : m.startsWith("Sea") ? "Sea" : m.startsWith("Road") ? "Road" : "Courier");
const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });

/** Customer Portal › Reports: shipment volumes and freight spend by month,
 *  plus CSV downloads of shipments and quotations. */
export default function PortalReportsPage() {
  const jobsQ = useMyJobs();
  const quotesQ = usePortalQuotes();
  const won = (quotesQ.data ?? []).filter((q) => q.status === "accepted" || q.status === "completed");
  const linesQ = usePortalLines(won.map((q) => q.id));
  const [months, setMonths] = useState(12);

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
    const m = new Map<string, number>();
    const by = new Map<string, NonNullable<typeof linesQ.data>>();
    for (const l of linesQ.data ?? []) by.set(l.quote_id, [...(by.get(l.quote_id) ?? []), l]);
    for (const [id, ls] of by) m.set(id, portalTotals(ls).total);
    return m;
  }, [linesQ.data]);
  const spendSeries = keys.map((k) => ({
    k,
    v: won.filter((q) => monthKey(q.accepted_at ?? q.created_at) === k).reduce((s, q) => s + (totalByQuote.get(q.id) ?? 0), 0),
  }));
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
            <h2>Shipments per month</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(`shipments-${todayIso()}.csv`, ["Shipment", "Mode", "Status", "Origin", "Destination", "AWB / B/L", "Container", "ETD", "ETA", "Created"], jobs.map((j) => [j.reference, j.mode, j.shipment_status || j.milestone, j.origin, j.destination, j.awb_mbl, j.container_no, formatDate(j.etd), formatDate(j.eta), formatDate(j.created_at)]))
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
            <h2>Freight spend (accepted quotations, incl. VAT)</h2>
            <button
              className="btn outline btn-sm"
              onClick={() =>
                downloadCsv(`quotations-${todayIso()}.csv`, ["Quotation", "Status", "Mode", "Origin", "Destination", "Commodity", "Your reference", "Total incl. VAT", "Date"], (quotesQ.data ?? []).map((q) => [q.reference, portalQuoteStatus(q).label, q.mode, q.origin, q.destination, q.commodity, q.customer_reference, totalByQuote.has(q.id) ? (totalByQuote.get(q.id) ?? 0).toFixed(2) : "", formatDate(q.created_at)]))
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
      </div>
    </>
  );
}
