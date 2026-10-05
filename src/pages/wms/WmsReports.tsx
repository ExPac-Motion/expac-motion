import { useMemo, useState } from "react";
import DateInput from "../../components/DateInput";
import { EmptyState, Loading, PageTools } from "../../components/common";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  CONDITION_LABEL,
  RECEIPT_STATUS_LABEL,
  daysBetween,
  downloadCsv,
  firstOfMonthIso,
  share,
  todayIso,
  useWmsBillingRuns,
  useWmsMovements,
  useWmsMoves,
  useWmsReceipts,
  useWmsReleases,
} from "../../lib/wms";
import { useWmsLookups } from "./shared";

type ReportId = "soh" | "ageing" | "receipts" | "releases" | "movements" | "billing" | "exceptions";

const REPORTS: { id: ReportId; label: string; hint: string; period: "asAt" | "range" | "none" }[] = [
  { id: "soh", label: "Stock on hand", hint: "What was in the warehouse at the end of a day, per receipt and bay", period: "asAt" },
  { id: "ageing", label: "Stock ageing", hint: "Receipts in stock by days in store", period: "none" },
  { id: "receipts", label: "Receipts register", hint: "Everything received in the period", period: "range" },
  { id: "releases", label: "Releases register", hint: "Everything released in the period", period: "range" },
  { id: "movements", label: "Movement history", hint: "Bay-to-bay moves in the period", period: "range" },
  { id: "billing", label: "Storage billing", hint: "Billing runs created in the period", period: "range" },
  { id: "exceptions", label: "Exceptions", hint: "Receipts not in good order (damaged, wet, short, over, repacked)", period: "range" },
];

type Cell = string | number;

/** WMS > Reports: registers and stock reports, each exportable to CSV. */
export default function WmsReports() {
  const lk = useWmsLookups();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const releasesQ = useWmsReleases();
  const movementsQ = useWmsMovements();
  const runsQ = useWmsBillingRuns();
  const [id, setId] = useState<ReportId>("soh");
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [clientId, setClientId] = useState("");
  const def = REPORTS.find((r) => r.id === id)!;

  // Compared on the local calendar day.
  const inRange = (iso: string) => {
    const l = new Date(iso);
    const day = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`;
    return day >= from && day <= to;
  };

  const report = useMemo((): { head: string[]; rows: Cell[][]; numeric: number[] } => {
    const receipts = (receiptsQ.data ?? []).filter((r) => !clientId || r.client_id === clientId);
    const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
    switch (id) {
      case "soh": {
        const cutoff = new Date(`${to}T23:59:59`).getTime();
        const map = new Map<string, number>();
        for (const m of movesQ.data ?? []) {
          if (new Date(m.at).getTime() > cutoff) continue;
          const k = `${m.receipt_id}|${m.location_id ?? ""}`;
          map.set(k, (map.get(k) ?? 0) + m.qty);
        }
        const rows: Cell[][] = [];
        for (const [k, pcs] of map) {
          if (pcs <= 0) continue;
          const [rid, loc] = k.split("|");
          const r = recById.get(rid);
          if (!r || (clientId && r.client_id !== clientId)) continue;
          const sh = share(r, pcs);
          rows.push([lk.clientName(r.client_id), r.receipt_no, formatDate(r.received_at), lk.whCode(r.warehouse_id), lk.locName(loc || null), r.description ?? "", pcs, sh.pallets.toFixed(1), sh.kg.toFixed(2), sh.cbm.toFixed(3)]);
        }
        rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
        return { head: ["Customer", "Receipt", "Received", "Warehouse", "Zone / bay", "Description", "Pieces", "Pallets", "Kg", "CBM"], rows, numeric: [6, 7, 8, 9] };
      }
      case "ageing": {
        const rows = receipts
          .filter((r) => r.on_hand > 0)
          .map((r) => {
            const days = daysBetween(r.received_at, new Date());
            const bucket = days <= 7 ? "0–7" : days <= 30 ? "8–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+";
            return [lk.clientName(r.client_id), r.receipt_no, formatDate(r.received_at), days, bucket, r.on_hand, r.on_hand_kg.toFixed(2), r.on_hand_cbm.toFixed(3)] as Cell[];
          })
          .sort((a, b) => Number(b[3]) - Number(a[3]));
        return { head: ["Customer", "Receipt", "Received", "Days", "Bucket", "Pieces", "Kg", "CBM"], rows, numeric: [5, 6, 7] };
      }
      case "receipts": {
        const rows = receipts
          .filter((r) => inRange(r.received_at))
          .map((r) => [
            r.receipt_no,
            formatDateTime(r.received_at),
            lk.clientName(r.client_id),
            lk.jobRef(r.job_id),
            lk.whCode(r.warehouse_id),
            r.inbound_ref ?? "",
            r.description ?? "",
            r.packages.map((p) => p.sku).filter(Boolean).join(" "),
            r.pieces,
            r.pallets,
            r.gross_kg.toFixed(2),
            r.volume_cbm.toFixed(3),
            CONDITION_LABEL[r.condition],
            RECEIPT_STATUS_LABEL[r.status],
          ] as Cell[]);
        return {
          head: ["Receipt", "Received", "Customer", "Shipment", "Warehouse", "Inbound ref", "Description", "SKUs", "Pieces", "Pallets", "Kg", "CBM", "Condition", "Status"],
          rows,
          numeric: [8, 9, 10, 11],
        };
      }
      case "releases": {
        const rows: Cell[][] = [];
        for (const rel of releasesQ.data ?? []) {
          if (!inRange(rel.released_at)) continue;
          for (const l of rel.lines) {
            const r = recById.get(l.receipt_id);
            if (clientId && r?.client_id !== clientId) continue;
            rows.push([rel.release_no, formatDateTime(rel.released_at), lk.clientName(r?.client_id), r?.receipt_no ?? "", lk.locName(l.location_id), r?.description ?? "", l.pieces, l.gross_kg.toFixed(2), l.volume_cbm.toFixed(3), rel.collected_by ?? "", rel.vehicle_reg ?? "", rel.outbound_ref ?? ""]);
          }
        }
        return { head: ["Release", "Released", "Customer", "Receipt", "From bay", "Description", "Pieces", "Kg", "CBM", "Collected by", "Vehicle", "Outbound ref"], rows, numeric: [6, 7, 8] };
      }
      case "movements": {
        const rows = (movementsQ.data ?? [])
          .filter((m) => inRange(m.moved_at))
          .filter((m) => !clientId || recById.get(m.receipt_id)?.client_id === clientId)
          .map((m) => {
            const r = recById.get(m.receipt_id);
            return [m.movement_no, formatDateTime(m.moved_at), r?.receipt_no ?? "", lk.clientName(r?.client_id), lk.locName(m.from_location_id), lk.locName(m.to_location_id), m.pieces, m.reason ?? "", lk.person(m.moved_by)] as Cell[];
          });
        return { head: ["Movement", "Moved", "Receipt", "Customer", "From", "To", "Pieces", "Reason", "By"], rows, numeric: [6] };
      }
      case "billing": {
        const rows = (runsQ.data ?? [])
          .filter((r) => inRange(r.created_at) && (!clientId || r.client_id === clientId))
          .map((r) => [r.run_no, formatDate(r.created_at), lk.clientName(r.client_id), `${formatDate(r.period_from)} – ${formatDate(r.period_to)}`, r.subtotal.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2), r.status === "invoiced" ? "Invoiced" : "Not invoiced", r.invoice_no ?? ""] as Cell[]);
        return { head: ["Run", "Created", "Customer", "Period", "Excl. VAT", "VAT", "Total", "Status", "Invoice No"], rows, numeric: [4, 5, 6] };
      }
      case "exceptions": {
        const rows = receipts
          .filter((r) => r.condition !== "good" && inRange(r.received_at))
          .map((r) => [r.receipt_no, formatDate(r.received_at), lk.clientName(r.client_id), lk.jobRef(r.job_id), r.description ?? "", CONDITION_LABEL[r.condition], r.condition_notes ?? "", r.pieces] as Cell[]);
        return { head: ["Receipt", "Received", "Customer", "Shipment", "Description", "Condition", "Notes", "Pieces"], rows, numeric: [7] };
      }
    }
  }, [id, from, to, clientId, receiptsQ.data, movesQ.data, releasesQ.data, movementsQ.data, runsQ.data, lk]);

  const totals = report.numeric.map((i) => report.rows.reduce((s, r) => s + (Number(r[i]) || 0), 0));
  const loading = receiptsQ.isLoading || movesQ.isLoading;

  return (
    <>
      <PageTools
        filters={
          <>
            <select value={id} onChange={(e) => setId(e.target.value as ReportId)} style={{ width: "auto" }}>
              {REPORTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "auto" }}>
              <option value="">All customers</option>
              {lk.clients
                .filter((c) => (receiptsQ.data ?? []).some((r) => r.client_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company}
                  </option>
                ))}
            </select>
            {def.period === "range" && (
              <>
                <DateInput value={from} onChange={setFrom} title="From" />
                <DateInput value={to} onChange={setTo} title="To" />
              </>
            )}
            {def.period === "asAt" && <DateInput value={to} onChange={setTo} title="As at" />}
          </>
        }
        count={`${report.rows.length} row${report.rows.length === 1 ? "" : "s"}`}
        hint={def.hint}
      >
        <button
          className="btn outline"
          disabled={report.rows.length === 0}
          onClick={() => downloadCsv(`wms-${id}-${def.period === "none" ? todayIso() : def.period === "asAt" ? to : `${from}_${to}`}.csv`, report.head, report.rows)}
        >
          Export CSV
        </button>
      </PageTools>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>{def.label}</h2>
            <p>
              {def.hint}
              {def.period === "asAt" ? ` — as at ${formatDate(to)}` : def.period === "range" ? ` — ${formatDate(from)} to ${formatDate(to)}` : ""}
            </p>
          </div>
        </div>
        {loading ? (
          <Loading />
        ) : report.rows.length === 0 ? (
          <EmptyState>Nothing to report.</EmptyState>
        ) : (
          <div className="wms-report-wrap">
            <table className="table--compact wms-mini">
              <thead>
                <tr>
                  {report.head.map((h, i) => (
                    <th key={h} style={report.numeric.includes(i) ? { textAlign: "right" } : undefined}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j} style={report.numeric.includes(j) ? { textAlign: "right" } : undefined}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.numeric.length > 0 && (
                <tfoot>
                  <tr>
                    {report.head.map((_, j) => {
                      const k = report.numeric.indexOf(j);
                      return (
                        <td key={j} style={k >= 0 ? { textAlign: "right" } : undefined}>
                          {j === 0 ? "Totals" : k >= 0 ? (Number.isInteger(totals[k]) ? totals[k] : totals[k].toFixed(2)) : ""}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </>
  );
}
