import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  SearchInput,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDateTime } from "../../lib/format";
import {
  stockByLocation,
  useWmsMovements,
  useWmsMoves,
  useWmsMutation,
  useWmsReceipts,
  wmsDb,
  type WmsMovement,
} from "../../lib/wms";
import { LocationOptions, orNull, useWmsLookups } from "./shared";

/** WMS > Warehouse Movements: bay-to-bay moves (MV000001). */
export default function WmsMovements() {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const movementsQ = useWmsMovements();
  const receiptsQ = useWmsReceipts();
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState(false);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const undo = useWmsMutation(wmsDb.deleteMovement);
  const recById = useMemo(() => new Map((receiptsQ.data ?? []).map((r) => [r.id, r])), [receiptsQ.data]);

  const rows = movementsQ.data ?? [];
  const filtered = rows.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const r = recById.get(m.receipt_id);
    return [m.movement_no, r?.receipt_no, r?.description, lk.clientName(r?.client_id), m.reason, lk.locName(m.from_location_id), lk.locName(m.to_location_id)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const columns: DataColumn<WmsMovement>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 70,
      render: (m) => (
        <RowActions
          onDelete={() => {
            if (!confirm(`Undo ${m.movement_no}? The pieces go back to ${lk.locName(m.from_location_id)}.`)) return;
            undo.mutate(m.id, { onSuccess: () => toast("Movement undone"), onError: (e) => error(e.message) });
          }}
        />
      ),
    },
    { key: "no", header: "Movement No", width: 110, render: (m) => <b>{m.movement_no}</b>, sortValue: (m) => m.movement_no },
    { key: "date", header: "Moved", width: 140, render: (m) => formatDateTime(m.moved_at), sortValue: (m) => m.moved_at },
    { key: "rec", header: "Receipt", width: 100, render: (m) => recById.get(m.receipt_id)?.receipt_no ?? "—" },
    { key: "client", header: "Customer", width: 170, render: (m) => lk.clientName(recById.get(m.receipt_id)?.client_id) },
    { key: "desc", header: "Description", width: 180, render: (m) => recById.get(m.receipt_id)?.description || "—" },
    { key: "from", header: "From", width: 120, render: (m) => lk.locName(m.from_location_id) },
    { key: "to", header: "To", width: 120, render: (m) => lk.locName(m.to_location_id) },
    { key: "pcs", header: "Pieces", width: 70, render: (m) => m.pieces },
    { key: "reason", header: "Reason", width: 180, render: (m) => m.reason || "—" },
    { key: "by", header: "By", width: 130, render: (m) => lk.person(m.moved_by) },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search movement, receipt, bay…" />}
        count={movementsQ.isLoading ? undefined : `${filtered.length} movement${filtered.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setMoving(true)}>
            + Move stock
          </button>
        }
      />
      <div className="panel">
        {movementsQ.isLoading ? (
          <Loading />
        ) : movementsQ.isError ? (
          <ErrorNote error={movementsQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>No movements yet. + Move stock moves pieces from one zone / bay to another.</EmptyState>
        ) : (
          <DataTable
            tableKey="wms-movements"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(m) => m.id}
          />
        )}
      </div>
      {moving && <MoveStockModal onClose={() => setMoving(false)} />}
    </>
  );
}

export function MoveStockModal({ onClose, receiptId }: { onClose: () => void; receiptId?: string }) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const create = useWmsMutation(wmsDb.createMovement);
  const inStock = (receiptsQ.data ?? []).filter((r) => r.on_hand > 0);
  const [rid, setRid] = useState(receiptId ?? "");
  const [from, setFrom] = useState<string>(
    () => stockByLocation(movesQ.data ?? []).find((s) => s.receipt_id === receiptId)?.location_id ?? "",
  );
  const receipt = inStock.find((r) => r.id === rid);
  const stock = stockByLocation(movesQ.data ?? []).filter((s) => s.receipt_id === rid);
  const fromStock = stock.find((s) => (s.location_id ?? "") === from);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const to = orNull(String(f.get("to") ?? ""));
    const pieces = Number(f.get("pieces")) || 0;
    if (!receipt || !fromStock) return error("Pick the receipt and the bay it's in");
    if (pieces <= 0 || pieces > fromStock.on_hand) return error(`Move 1 – ${fromStock.on_hand} pieces`);
    if ((to ?? "") === from) return error("Pick a different bay to move to");
    create.mutate(
      {
        receipt_id: receipt.id,
        from_location_id: orNull(from),
        to_location_id: to,
        pieces,
        reason: orNull(String(f.get("reason") ?? "").trim()),
      },
      {
        onSuccess: () => {
          toast(`${pieces} piece${pieces === 1 ? "" : "s"} moved to ${lk.locName(to)}`);
          onClose();
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title="Move stock" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label>Receipt</label>
          <select
            value={rid}
            onChange={(e) => {
              setRid(e.target.value);
              const first = stockByLocation(movesQ.data ?? []).find((s) => s.receipt_id === e.target.value);
              setFrom(first?.location_id ?? "");
            }}
            autoFocus
          >
            <option value="">— pick a receipt in stock —</option>
            {inStock.map((r) => (
              <option key={r.id} value={r.id}>
                {r.receipt_no} — {lk.clientName(r.client_id)}
                {r.description ? ` — ${r.description}` : ""} ({r.on_hand} pcs)
              </option>
            ))}
          </select>
        </div>
        <div className="grid2">
          <div className="field">
            <label>From</label>
            <select value={from} onChange={(e) => setFrom(e.target.value)} disabled={!receipt}>
              <option value="" disabled={!stock.some((s) => !s.location_id)}>
                {stock.some((s) => !s.location_id)
                  ? `Unassigned (${stock.find((s) => !s.location_id)?.on_hand} pcs)`
                  : "— pick —"}
              </option>
              {stock
                .filter((s) => s.location_id)
                .map((s) => (
                  <option key={s.location_id} value={s.location_id ?? ""}>
                    {lk.locName(s.location_id)} ({s.on_hand} pcs)
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label>To</label>
            <select name="to" defaultValue="" disabled={!receipt}>
              <option value="">Unassigned</option>
              <LocationOptions locations={lk.locations} warehouseId={receipt?.warehouse_id} />
            </select>
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label>Pieces</label>
            <input
              key={`${rid}|${from}`}
              name="pieces"
              type="number"
              min={1}
              max={fromStock?.on_hand}
              defaultValue={fromStock?.on_hand ?? ""}
            />
          </div>
          <div className="field">
            <label>Reason</label>
            <input name="reason" placeholder="e.g. consolidating, staging for dispatch" />
          </div>
        </div>
        <div className="modal-foot-row">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={create.isPending || !fromStock}>
            {create.isPending ? "Moving…" : "Move"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
