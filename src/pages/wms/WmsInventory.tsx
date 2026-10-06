import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, Loading, PageTools, SearchInput } from "../../components/common";
import { formatDate } from "../../lib/format";
import {
  daysBetween,
  downloadCsv,
  qty,
  share,
  stockByLocation,
  todayIso,
  useWmsMoves,
  useWmsReceipts,
  type WmsReceipt,
} from "../../lib/wms";
import { MoveStockModal } from "./WmsMovements";
import { useWmsLookups } from "./shared";

type View = "bay" | "sku" | "customer";

interface StockRow {
  id: string;
  receipt: WmsReceipt;
  location_id: string | null;
  on_hand: number;
  kg: number;
  cbm: number;
  pallets: number;
  days: number;
}
interface SkuRow {
  id: string;
  sku: string;
  description: string;
  receipt: WmsReceipt;
  qty: number;
  estimated: boolean;
}
interface CustomerRow {
  id: string;
  client_id: string | null;
  receipts: number;
  pieces: number;
  kg: number;
  cbm: number;
  pallets: number;
  oldest: string;
}

/** WMS > Warehouse Inventory: what's on hand, by bay, by SKU or by customer. */
export default function WmsInventory() {
  const lk = useWmsLookups();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const [view, setView] = useState<View>("bay");
  const [search, setSearch] = useState("");
  const [whId, setWhId] = useState("");
  const [clientId, setClientId] = useState("");
  const [moveId, setMoveId] = useState<string | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const recById = useMemo(() => new Map((receiptsQ.data ?? []).map((r) => [r.id, r])), [receiptsQ.data]);
  const keep = (r: WmsReceipt) => (!whId || r.warehouse_id === whId) && (!clientId || r.client_id === clientId);
  const q = search.trim().toLowerCase();

  const stockRows: StockRow[] = useMemo(
    () =>
      stockByLocation(movesQ.data ?? [])
        .map((s) => {
          const r = recById.get(s.receipt_id);
          if (!r) return null;
          const sh = share(r, s.on_hand);
          return {
            id: `${s.receipt_id}|${s.location_id ?? ""}`,
            receipt: r,
            location_id: s.location_id,
            on_hand: s.on_hand,
            kg: sh.kg,
            cbm: sh.cbm,
            pallets: sh.pallets,
            days: daysBetween(r.received_at, new Date()),
          };
        })
        .filter((x): x is StockRow => !!x),
    [movesQ.data, recById],
  );
  const visibleStock = stockRows.filter(
    (s) =>
      keep(s.receipt) &&
      (!q ||
        [s.receipt.receipt_no, s.receipt.description, lk.clientName(s.receipt.client_id), lk.locName(s.location_id), lk.jobRef(s.receipt.job_id)]
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );

  // SKU view: package items of receipts with stock. Part-released receipts
  // scale their item qty pro rata (releases are booked in pieces, not per SKU).
  const skuRows: SkuRow[] = (receiptsQ.data ?? [])
    .filter((r) => r.on_hand > 0 && keep(r))
    .flatMap((r) =>
      r.packages.map((p, i) => {
        const full = Number(p.qty) || 0;
        const partial = r.on_hand < r.pieces;
        return {
          id: `${r.id}|${i}`,
          sku: p.sku || "—",
          description: p.description || r.description || "—",
          receipt: r,
          qty: partial && r.pieces > 0 ? Math.round((full * r.on_hand) / r.pieces) : full,
          estimated: partial,
        };
      }),
    )
    .filter((s) => !q || [s.sku, s.description, s.receipt.receipt_no, lk.clientName(s.receipt.client_id)].join(" ").toLowerCase().includes(q));

  const customerRows: CustomerRow[] = useMemo(() => {
    const m = new Map<string, CustomerRow>();
    for (const s of visibleStock) {
      const k = s.receipt.client_id ?? "";
      const cur =
        m.get(k) ??
        ({ id: k || "none", client_id: s.receipt.client_id, receipts: 0, pieces: 0, kg: 0, cbm: 0, pallets: 0, oldest: s.receipt.received_at } as CustomerRow);
      cur.pieces += s.on_hand;
      cur.kg += s.kg;
      cur.cbm += s.cbm;
      cur.pallets += s.pallets;
      if (s.receipt.received_at < cur.oldest) cur.oldest = s.receipt.received_at;
      m.set(k, cur);
    }
    for (const c of m.values()) {
      c.receipts = new Set(visibleStock.filter((s) => (s.receipt.client_id ?? "") === (c.client_id ?? "")).map((s) => s.receipt.id)).size;
    }
    return [...m.values()];
  }, [visibleStock]);

  const stockCols: DataColumn<StockRow>[] = [
    {
      key: "actions",
      header: "Actions",
      fixed: true,
      width: 70,
      render: (s) => (
        <button className="link-btn" onClick={(e) => { e.stopPropagation(); setMoveId(s.receipt.id); }}>
          Move
        </button>
      ),
    },
    { key: "wh", header: "Warehouse", width: 90, render: (s) => lk.whCode(s.receipt.warehouse_id) },
    { key: "bay", header: "Zone / bay", width: 120, render: (s) => lk.locName(s.location_id), sortValue: (s) => lk.locName(s.location_id) },
    { key: "rec", header: "Receipt", width: 100, render: (s) => <b>{s.receipt.receipt_no}</b>, sortValue: (s) => s.receipt.receipt_no },
    { key: "client", header: "Customer", width: 180, render: (s) => lk.clientName(s.receipt.client_id), sortValue: (s) => lk.clientName(s.receipt.client_id) },
    { key: "job", header: "Shipment", width: 100, render: (s) => lk.jobRef(s.receipt.job_id) },
    { key: "desc", header: "Description", width: 200, render: (s) => s.receipt.description || "—" },
    { key: "pcs", header: "Pieces", width: 70, render: (s) => s.on_hand, sortValue: (s) => s.on_hand },
    { key: "pal", header: "Pallets", width: 70, render: (s) => qty(s.pallets, 1), sortValue: (s) => s.pallets },
    { key: "kg", header: "Kg", width: 80, render: (s) => qty(s.kg), sortValue: (s) => s.kg },
    { key: "cbm", header: "CBM", width: 80, render: (s) => qty(s.cbm, 3), sortValue: (s) => s.cbm },
    { key: "rcv", header: "Received", width: 100, render: (s) => formatDate(s.receipt.received_at), sortValue: (s) => s.receipt.received_at },
    {
      key: "days",
      header: "Days",
      width: 60,
      render: (s) => <span className={s.days > 60 ? "wms-warn" : undefined}>{s.days}</span>,
      sortValue: (s) => s.days,
    },
  ];
  const skuCols: DataColumn<SkuRow>[] = [
    { key: "sku", header: "SKU", width: 130, render: (s) => <b>{s.sku}</b>, sortValue: (s) => s.sku },
    { key: "desc", header: "Description", width: 220, render: (s) => s.description, sortValue: (s) => s.description },
    { key: "client", header: "Customer", width: 180, render: (s) => lk.clientName(s.receipt.client_id), sortValue: (s) => lk.clientName(s.receipt.client_id) },
    { key: "rec", header: "Receipt", width: 100, render: (s) => s.receipt.receipt_no, sortValue: (s) => s.receipt.receipt_no },
    { key: "wh", header: "Warehouse", width: 90, render: (s) => lk.whCode(s.receipt.warehouse_id) },
    {
      key: "qty",
      header: "Qty on hand",
      width: 110,
      render: (s) => (
        <span title={s.estimated ? "Receipt part released, pro rata estimate" : undefined}>
          {s.qty}
          {s.estimated ? " ≈" : ""}
        </span>
      ),
      sortValue: (s) => s.qty,
    },
    { key: "rcv", header: "Received", width: 100, render: (s) => formatDate(s.receipt.received_at), sortValue: (s) => s.receipt.received_at },
  ];
  const customerCols: DataColumn<CustomerRow>[] = [
    { key: "client", header: "Customer", width: 220, render: (c) => <b>{lk.clientName(c.client_id)}</b>, sortValue: (c) => lk.clientName(c.client_id) },
    { key: "rec", header: "Receipts", width: 90, render: (c) => c.receipts, sortValue: (c) => c.receipts },
    { key: "pcs", header: "Pieces", width: 90, render: (c) => c.pieces, sortValue: (c) => c.pieces },
    { key: "pal", header: "Pallets", width: 90, render: (c) => qty(c.pallets, 1), sortValue: (c) => c.pallets },
    { key: "kg", header: "Kg", width: 100, render: (c) => qty(c.kg), sortValue: (c) => c.kg },
    { key: "cbm", header: "CBM", width: 100, render: (c) => qty(c.cbm, 3), sortValue: (c) => c.cbm },
    { key: "old", header: "Oldest receipt", width: 120, render: (c) => formatDate(c.oldest), sortValue: (c) => c.oldest },
  ];

  function exportCsv() {
    const d = todayIso();
    if (view === "bay")
      downloadCsv(
        `inventory-${d}.csv`,
        ["Warehouse", "Zone / bay", "Receipt", "Customer", "Shipment", "Description", "Pieces", "Pallets", "Kg", "CBM", "Received", "Days"],
        visibleStock.map((s) => [
          lk.whCode(s.receipt.warehouse_id),
          lk.locName(s.location_id),
          s.receipt.receipt_no,
          lk.clientName(s.receipt.client_id),
          lk.jobRef(s.receipt.job_id),
          s.receipt.description,
          s.on_hand,
          s.pallets.toFixed(1),
          s.kg.toFixed(2),
          s.cbm.toFixed(3),
          formatDate(s.receipt.received_at),
          s.days,
        ]),
      );
    else if (view === "sku")
      downloadCsv(
        `inventory-sku-${d}.csv`,
        ["SKU", "Description", "Customer", "Receipt", "Warehouse", "Qty on hand", "Estimated", "Received"],
        skuRows.map((s) => [s.sku, s.description, lk.clientName(s.receipt.client_id), s.receipt.receipt_no, lk.whCode(s.receipt.warehouse_id), s.qty, s.estimated ? "yes" : "", formatDate(s.receipt.received_at)]),
      );
    else
      downloadCsv(
        `inventory-customers-${d}.csv`,
        ["Customer", "Receipts", "Pieces", "Pallets", "Kg", "CBM", "Oldest receipt"],
        customerRows.map((c) => [lk.clientName(c.client_id), c.receipts, c.pieces, c.pallets.toFixed(1), c.kg.toFixed(2), c.cbm.toFixed(3), formatDate(c.oldest)]),
      );
  }

  const totals = visibleStock.reduce(
    (t, s) => ({ pcs: t.pcs + s.on_hand, kg: t.kg + s.kg, cbm: t.cbm + s.cbm }),
    { pcs: 0, kg: 0, cbm: 0 },
  );
  const stockClients = lk.clients.filter((c) => stockRows.some((s) => s.receipt.client_id === c.id));

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search receipt, SKU, customer, bay…" />}
        filters={
          <>
            <div className="wms-seg">
              {(["bay", "sku", "customer"] as View[]).map((v) => (
                <button key={v} type="button" className={view === v ? "active" : ""} onClick={() => setView(v)}>
                  {v === "bay" ? "By bay" : v === "sku" ? "By SKU" : "By customer"}
                </button>
              ))}
            </div>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "auto" }}>
              <option value="">All customers</option>
              {stockClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
            {lk.warehouses.length > 1 && (
              <select value={whId} onChange={(e) => setWhId(e.target.value)} style={{ width: "auto" }}>
                <option value="">All warehouses</option>
                {lk.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            )}
          </>
        }
        count={`${totals.pcs} pcs · ${qty(totals.kg)} kg · ${qty(totals.cbm, 3)} CBM`}
        onToolsSlot={setToolsSlot}
      >
        <button className="btn outline" onClick={exportCsv}>
          Export CSV
        </button>
      </PageTools>

      <div className="panel">
        {receiptsQ.isLoading || movesQ.isLoading ? (
          <Loading />
        ) : view === "bay" ? (
          visibleStock.length === 0 ? (
            <EmptyState>Nothing on hand.</EmptyState>
          ) : (
            <DataTable tableKey="wms-inventory-bay" className="table--compact" toolsPortal={toolsSlot} columns={stockCols} rows={visibleStock} rowKey={(s) => s.id} />
          )
        ) : view === "sku" ? (
          skuRows.length === 0 ? (
            <EmptyState>No SKUs on hand, add package items with SKU numbers on the receipts.</EmptyState>
          ) : (
            <DataTable tableKey="wms-inventory-sku" className="table--compact" toolsPortal={toolsSlot} columns={skuCols} rows={skuRows} rowKey={(s) => s.id} />
          )
        ) : customerRows.length === 0 ? (
          <EmptyState>Nothing on hand.</EmptyState>
        ) : (
          <DataTable tableKey="wms-inventory-customer" className="table--compact" toolsPortal={toolsSlot} columns={customerCols} rows={customerRows} rowKey={(c) => c.id} />
        )}
      </div>
      {moveId && <MoveStockModal receiptId={moveId} onClose={() => setMoveId(null)} />}
    </>
  );
}
