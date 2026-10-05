import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageTools } from "../../components/common";
import { formatDateTime, money } from "../../lib/format";
import {
  daysBetween,
  locationLabel,
  qty,
  share,
  stockByLocation,
  useWmsBillingRuns,
  useWmsConsols,
  useWmsCounts,
  useWmsMoves,
  useWmsReceipts,
} from "../../lib/wms";
import { ReceiptEditModal } from "./WmsReceipts";
import { Kpi, useWmsLookups } from "./shared";

const AGE_BUCKETS: [string, number, number][] = [
  ["0 – 7 days", 0, 7],
  ["8 – 30 days", 8, 30],
  ["31 – 60 days", 31, 60],
  ["61 – 90 days", 61, 90],
  ["90+ days", 91, Infinity],
];

/** WMS > Dashboard: what's in the warehouse, what's moving, what's ageing. */
export default function WmsDashboard() {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const runsQ = useWmsBillingRuns();
  const countsQ = useWmsCounts();
  const consolsQ = useWmsConsols();
  const [receiving, setReceiving] = useState(false);

  const d = useMemo(() => {
    const receipts = receiptsQ.data ?? [];
    const moves = movesQ.data ?? [];
    const inStock = receipts.filter((r) => r.on_hand > 0);
    const weekAgo = Date.now() - 7 * 86_400_000;
    const sum = (k: "on_hand" | "on_hand_kg" | "on_hand_cbm") => inStock.reduce((s, r) => s + r[k], 0);
    const releasedPcs = -moves
      .filter((m) => m.kind === "release" && new Date(m.at).getTime() >= weekAgo)
      .reduce((s, m) => s + m.qty, 0);
    const receivedWeek = receipts.filter((r) => new Date(r.received_at).getTime() >= weekAgo);

    const ageing = AGE_BUCKETS.map(([label, lo, hi]) => {
      const rs = inStock.filter((r) => {
        const days = daysBetween(r.received_at, new Date());
        return days >= lo && days <= hi;
      });
      return { label, receipts: rs.length, cbm: rs.reduce((s, r) => s + r.on_hand_cbm, 0) };
    });

    const byClient = new Map<string, number>();
    for (const r of inStock) byClient.set(r.client_id ?? "", (byClient.get(r.client_id ?? "") ?? 0) + r.on_hand_cbm);
    const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    const recById = new Map(receipts.map((r) => [r.id, r]));
    const cbmByLoc = new Map<string, number>();
    for (const s of stockByLocation(moves)) {
      const r = recById.get(s.receipt_id);
      if (r && s.location_id) cbmByLoc.set(s.location_id, (cbmByLoc.get(s.location_id) ?? 0) + share(r, s.on_hand).cbm);
    }
    const util = lk.locations
      .filter((l) => l.active && Number(l.capacity_cbm) > 0)
      .map((l) => ({ loc: l, used: cbmByLoc.get(l.id) ?? 0, cap: Number(l.capacity_cbm) }))
      .sort((a, b) => b.used / b.cap - a.used / a.cap)
      .slice(0, 10);

    const recent = [...moves].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10).map((m) => ({ m, r: recById.get(m.receipt_id) }));

    return {
      inStock,
      pcs: sum("on_hand"),
      kg: sum("on_hand_kg"),
      cbm: sum("on_hand_cbm"),
      releasedPcs,
      receivedWeek,
      ageing,
      topClients,
      util,
      recent,
      exceptions: inStock.filter((r) => r.condition !== "good").length,
      unbilled: (runsQ.data ?? []).filter((r) => r.status === "draft").reduce((s, r) => s + r.total, 0),
      openCounts: (countsQ.data ?? []).filter((c) => c.status === "open").length,
      openConsols: (consolsQ.data ?? []).filter((c) => c.status !== "departed").length,
    };
  }, [receiptsQ.data, movesQ.data, runsQ.data, countsQ.data, consolsQ.data, lk.locations]);

  const KIND: Record<string, string> = { receipt: "Received", move: "Moved", release: "Released", adjust: "Count adj." };
  const maxAge = Math.max(1, ...d.ageing.map((a) => a.cbm));
  const maxClient = Math.max(1, ...d.topClients.map(([, v]) => v));

  return (
    <>
      <PageTools
        primary={
          <button className="btn" onClick={() => setReceiving(true)} disabled={lk.warehouses.length === 0}>
            + New receipt
          </button>
        }
      >
        <button className="btn outline" onClick={() => navigate("/wms?tab=release")}>
          + New release
        </button>
      </PageTools>

      <div className="cards wms-cards">
        <Kpi label="Receipts in stock" value={String(d.inStock.length)} sub={`${d.pcs} pieces`} />
        <Kpi label="Volume on hand" value={`${qty(d.cbm, 2)} CBM`} sub={`${qty(d.kg, 0)} kg`} tone="teal" />
        <Kpi label="Received (7 days)" value={String(d.receivedWeek.length)} sub={`${d.receivedWeek.reduce((s, r) => s + r.pieces, 0)} pieces`} />
        <Kpi label="Released (7 days)" value={`${d.releasedPcs} pcs`} />
        <Kpi label="Storage not invoiced" value={money(d.unbilled)} sub="incl. VAT, saved billing runs" tone={d.unbilled ? "amber" : undefined} />
        <Kpi label="Exceptions in stock" value={String(d.exceptions)} sub="damaged / wet / short / over" tone={d.exceptions ? "orange" : undefined} />
        <Kpi label="Open consolidations" value={String(d.openConsols)} />
        <Kpi label="Counts in progress" value={String(d.openCounts)} />
      </div>

      <div className="wms-dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Stock ageing</h2>
          </div>
          {d.ageing.map((a) => (
            <div key={a.label} className="wms-bar-row">
              <span className="wms-bar-label">{a.label}</span>
              <div className="wms-bar">
                <div style={{ width: `${(a.cbm / maxAge) * 100}%` }} className={a.label.startsWith("90") || a.label.startsWith("61") ? "old" : undefined} />
              </div>
              <span className="wms-bar-val">
                {a.receipts} · {qty(a.cbm, 2)} CBM
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Top customers by volume</h2>
          </div>
          {d.topClients.length === 0 ? (
            <p className="hint">Nothing in stock.</p>
          ) : (
            d.topClients.map(([id, cbm]) => (
              <div key={id} className="wms-bar-row">
                <span className="wms-bar-label">{lk.clientName(id || null)}</span>
                <div className="wms-bar">
                  <div style={{ width: `${(cbm / maxClient) * 100}%` }} />
                </div>
                <span className="wms-bar-val">{qty(cbm, 2)} CBM</span>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Bay utilisation</h2>
            <Link to="/wms?tab=settings" className="link-btn">
              Bays
            </Link>
          </div>
          {d.util.length === 0 ? (
            <p className="hint">Give bays a capacity (CBM) in WMS › Settings to see how full they are.</p>
          ) : (
            d.util.map(({ loc, used, cap }) => {
              const pct = Math.round((used / cap) * 100);
              return (
                <div key={loc.id} className="wms-bar-row">
                  <span className="wms-bar-label">
                    {lk.whCode(loc.warehouse_id)} {locationLabel(loc)}
                  </span>
                  <div className="wms-bar">
                    <div style={{ width: `${Math.min(100, pct)}%` }} className={pct >= 90 ? "old" : undefined} />
                  </div>
                  <span className="wms-bar-val">{pct}%</span>
                </div>
              );
            })
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Recent activity</h2>
          </div>
          {d.recent.length === 0 ? (
            <p className="hint">No warehouse activity yet.</p>
          ) : (
            <table className="table--compact wms-mini">
              <tbody>
                {d.recent.map(({ m, r }) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.at)}</td>
                    <td>{KIND[m.kind]}</td>
                    <td>{r?.receipt_no}</td>
                    <td>{lk.clientName(r?.client_id)}</td>
                    <td>{lk.locName(m.location_id)}</td>
                    <td className={m.qty < 0 ? "wms-neg" : undefined}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {receiving && (
        <ReceiptEditModal
          receipt={null}
          onClose={() => setReceiving(false)}
          onSaved={(id) => {
            setReceiving(false);
            navigate(`/wms/print/receipt/${id}`);
          }}
        />
      )}
    </>
  );
}
