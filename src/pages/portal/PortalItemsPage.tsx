import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, Loading, PageHeader, PageTools, SearchInput } from "../../components/common";
import { formatDate } from "../../lib/format";
import { downloadCsv, todayIso, useWmsReceipts } from "../../lib/wms";

interface SkuRow {
  sku: string;
  description: string;
  received: number;
  onHand: number;
  estimated: boolean;
  receipts: string[];
  lastIn: string;
}

/** Customer Portal › Items / SKU: every SKU booked into the ExPac warehouse on
 *  the customer's receipts, received and still in store. */
export default function PortalItemsPage() {
  const receiptsQ = useWmsReceipts();
  const [search, setSearch] = useState("");
  const [onlyStock, setOnlyStock] = useState(true);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const rows = useMemo<SkuRow[]>(() => {
    const m = new Map<string, SkuRow>();
    for (const r of receiptsQ.data ?? []) {
      for (const p of r.packages) {
        const key = (p.sku || p.description || "—").trim();
        const q = Number(p.qty) || 0;
        // Releases are booked in pieces per receipt, so a part-released
        // receipt's SKUs are estimated pro rata.
        const share = r.pieces > 0 ? r.on_hand / r.pieces : 0;
        const cur = m.get(key) ?? {
          sku: p.sku || "—",
          description: p.description || r.description || "—",
          received: 0,
          onHand: 0,
          estimated: false,
          receipts: [],
          lastIn: r.received_at,
        };
        cur.received += q;
        cur.onHand += Math.round(q * share);
        if (r.on_hand > 0 && r.on_hand < r.pieces) cur.estimated = true;
        cur.receipts.push(r.receipt_no);
        if (r.received_at > cur.lastIn) cur.lastIn = r.received_at;
        m.set(key, cur);
      }
    }
    return [...m.values()];
  }, [receiptsQ.data]);

  const n = search.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyStock || r.onHand > 0) && (!n || [r.sku, r.description, ...r.receipts].join(" ").toLowerCase().includes(n)));

  const columns: DataColumn<SkuRow>[] = [
    { key: "sku", header: "SKU", width: 150, render: (r) => <b>{r.sku}</b>, sortValue: (r) => r.sku },
    { key: "desc", header: "Description", width: 260, render: (r) => r.description, sortValue: (r) => r.description },
    {
      key: "onhand",
      header: "In Motion Warehouse",
      width: 100,
      render: (r) => (
        <span title={r.estimated ? "Part released, estimated" : undefined}>
          {r.onHand}
          {r.estimated ? " ≈" : ""}
        </span>
      ),
      sortValue: (r) => r.onHand,
    },
    { key: "recv", header: "Received", width: 100, render: (r) => r.received, sortValue: (r) => r.received },
    { key: "rec", header: "Receipts", width: 220, render: (r) => [...new Set(r.receipts)].join(", ") },
    { key: "last", header: "Last received", width: 120, render: (r) => formatDate(r.lastIn), sortValue: (r) => r.lastIn },
  ];

  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Items / SKU" />
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search SKU, description, receipt…" />}
        filters={
          <label className="check" style={{ margin: 0 }}>
            <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> In Motion Warehouse only
          </label>
        }
        count={`${shown.length} SKU${shown.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      >
        <button
          className="btn outline"
          disabled={shown.length === 0}
          onClick={() =>
            downloadCsv(
              `skus-${todayIso()}.csv`,
              ["SKU", "Description", "In Motion Warehouse", "Received", "Receipts", "Last received"],
              shown.map((r) => [r.sku, r.description, r.onHand, r.received, [...new Set(r.receipts)].join(" "), formatDate(r.lastIn)]),
            )
          }
        >
          Download CSV
        </button>
      </PageTools>
      <div className="panel">
        {receiptsQ.isLoading ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState>{rows.length === 0 ? "No SKUs booked into the warehouse yet." : "No SKUs match."}</EmptyState>
        ) : (
          <DataTable tableKey="portal-skus" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={shown} rowKey={(r) => r.sku + r.description} />
        )}
      </div>
    </>
  );
}
