import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageTools, RowActions, RowActionsHead } from "../../components/common";
import { useToast } from "../../components/Toast";
import { formatDate, formatDateTime } from "../../lib/format";
import { useWmsCounts, useWmsMutation, useWmsReceipts, wmsDb, type WmsCount } from "../../lib/wms";
import { LocationOptions, orNull, useWmsLookups } from "./shared";

const STATUS: Record<WmsCount["status"], { label: string; cls: string }> = {
  open: { label: "Counting", cls: "sent" },
  completed: { label: "Completed", cls: "completed" },
  cancelled: { label: "Cancelled", cls: "lost" },
};

/** WMS > Cycle Count: count a bay / zone / warehouse; completing posts variances. */
export default function WmsCycleCount() {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const countsQ = useWmsCounts();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const del = useWmsMutation(wmsDb.deleteCount);
  const rows = countsQ.data ?? [];
  const variances = (c: WmsCount) => c.lines.filter((l) => l.counted != null && l.counted !== l.expected).length;

  const columns: DataColumn<WmsCount>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 96,
      render: (c) => (
        <RowActions
          onView={() => setOpen(c.id)}
          onDelete={
            c.status === "completed"
              ? undefined
              : () => {
                  if (!confirm(`Delete ${c.count_no}?`)) return;
                  del.mutate(c.id, { onSuccess: () => toast("Count deleted"), onError: (e) => error(e.message) });
                }
          }
        />
      ),
    },
    { key: "no", header: "Count No", width: 100, render: (c) => <b>{c.count_no}</b>, sortValue: (c) => c.count_no },
    { key: "date", header: "Started", width: 100, render: (c) => formatDate(c.created_at), sortValue: (c) => c.created_at },
    { key: "wh", header: "Warehouse", width: 90, render: (c) => lk.whCode(c.warehouse_id) },
    { key: "bay", header: "Zone / bay", width: 130, render: (c) => (c.location_id ? lk.locName(c.location_id) : "Whole warehouse") },
    { key: "lines", header: "Lines", width: 70, render: (c) => c.lines.length },
    { key: "done", header: "Counted", width: 80, render: (c) => c.lines.filter((l) => l.counted != null).length },
    {
      key: "var",
      header: "Variances",
      width: 90,
      render: (c) => {
        const v = variances(c);
        return <span className={v ? "wms-warn" : undefined}>{v}</span>;
      },
    },
    { key: "by", header: "By", width: 130, render: (c) => lk.person(c.counted_by) },
    { key: "status", header: "Status", width: 110, render: (c) => <span className={`badge ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span> },
    { key: "closed", header: "Completed", width: 140, render: (c) => (c.completed_at ? formatDateTime(c.completed_at) : "—") },
  ];

  const current = rows.find((c) => c.id === open);

  return (
    <>
      <PageTools
        count={countsQ.isLoading ? undefined : `${rows.length} count${rows.length === 1 ? "" : "s"}`}
        hint="Start a count to snapshot what the system holds, enter what's physically there, then Complete, differences post as stock adjustments."
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setCreating(true)} disabled={lk.warehouses.length === 0}>
            + New count
          </button>
        }
      />
      <div className="panel">
        {countsQ.isLoading ? (
          <Loading />
        ) : countsQ.isError ? (
          <ErrorNote error={countsQ.error} />
        ) : rows.length === 0 ? (
          <EmptyState>No cycle counts yet.</EmptyState>
        ) : (
          <DataTable tableKey="wms-counts" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setOpen(c.id)} />
        )}
      </div>
      {creating && (
        <NewCountModal
          onClose={() => setCreating(false)}
          onStarted={(id) => {
            setCreating(false);
            setOpen(id);
          }}
        />
      )}
      {current && <CountSheetModal count={current} onClose={() => setOpen(null)} />}
    </>
  );
}

function NewCountModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const lk = useWmsLookups();
  const { error } = useToast();
  const start = useWmsMutation((v: { wh: string; loc: string | null; notes: string }) => wmsDb.startCount(v.wh, v.loc, v.notes));
  const [wh, setWh] = useState(lk.warehouses[0]?.id ?? "");
  const [loc, setLoc] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Modal title="New cycle count" onClose={onClose}>
      <div className="grid2">
        <div className="field">
          <label>Warehouse</label>
          <select value={wh} onChange={(e) => { setWh(e.target.value); setLoc(""); }}>
            {lk.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}, {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Zone / bay</label>
          <select value={loc} onChange={(e) => setLoc(e.target.value)}>
            <option value="">Whole warehouse</option>
            <LocationOptions locations={lk.locations} warehouseId={wh} />
          </select>
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. monthly count, Zone A" />
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={start.isPending || !wh}
          onClick={() => start.mutate({ wh, loc: orNull(loc), notes }, { onSuccess: onStarted, onError: (e) => error(e.message) })}
        >
          {start.isPending ? "Starting…" : "Start count"}
        </button>
      </div>
    </Modal>
  );
}

function CountSheetModal({ count, onClose }: { count: WmsCount; onClose: () => void }) {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const receiptsQ = useWmsReceipts();
  const recById = new Map((receiptsQ.data ?? []).map((r) => [r.id, r]));
  const editable = count.status === "open";
  const [vals, setVals] = useState<Record<string, { counted: string; note: string }>>(() =>
    Object.fromEntries(count.lines.map((l) => [l.id, { counted: l.counted == null ? "" : String(l.counted), note: l.note ?? "" }])),
  );
  const [blind, setBlind] = useState(false);
  const saveLines = useWmsMutation(wmsDb.saveCountLines);
  const complete = useWmsMutation(wmsDb.completeCount);
  const cancel = useWmsMutation(wmsDb.cancelCount);

  const payload = () =>
    count.lines.map((l) => ({
      id: l.id,
      counted: vals[l.id]?.counted === "" ? null : Number(vals[l.id]?.counted),
      note: vals[l.id]?.note.trim() || null,
    }));
  const lines = [...count.lines].sort((a, b) => lk.locName(a.location_id).localeCompare(lk.locName(b.location_id)));
  const counted = Object.values(vals).filter((v) => v.counted !== "").length;

  async function saveThen(after?: () => Promise<unknown>) {
    try {
      await saveLines.mutateAsync(payload());
      if (after) await after();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  return (
    <Modal
      title={`${count.count_no}, ${lk.whCode(count.warehouse_id)} ${count.location_id ? lk.locName(count.location_id) : "(whole warehouse)"}`}
      onClose={onClose}
      wide
      stickyHeader
      headerActions={
        <>
          <span className={`badge ${STATUS[count.status].cls}`}>{STATUS[count.status].label}</span>
          <button className="btn outline btn-sm" onClick={() => navigate(`/wms/print/count/${count.id}`)}>
            Print count sheet
          </button>
        </>
      }
    >
      {editable && (
        <label className="check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind count (hide expected quantities)
        </label>
      )}
      {lines.length === 0 ? (
        <p className="hint">Nothing was on hand here when the count started.</p>
      ) : (
        <table className="table--compact wms-mini">
          <thead>
            <tr>
              <th>Zone / bay</th>
              <th>Receipt</th>
              <th>Customer</th>
              <th>Description</th>
              {!blind && <th>Expected</th>}
              <th style={{ width: 90 }}>Counted</th>
              {!blind && <th>Variance</th>}
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const r = recById.get(l.receipt_id);
              const v = vals[l.id] ?? { counted: "", note: "" };
              const diff = v.counted === "" ? null : Number(v.counted) - l.expected;
              return (
                <tr key={l.id}>
                  <td>{lk.locName(l.location_id)}</td>
                  <td>{r?.receipt_no ?? "—"}</td>
                  <td>{lk.clientName(r?.client_id)}</td>
                  <td>{r?.description || "—"}</td>
                  {!blind && <td>{l.expected}</td>}
                  <td>
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        value={v.counted}
                        onChange={(e) => setVals((p) => ({ ...p, [l.id]: { ...v, counted: e.target.value } }))}
                      />
                    ) : (
                      l.counted ?? "—"
                    )}
                  </td>
                  {!blind && (
                    <td className={diff ? "wms-warn" : undefined}>{diff == null ? "—" : diff > 0 ? `+${diff}` : diff}</td>
                  )}
                  <td>
                    {editable ? (
                      <input value={v.note} onChange={(e) => setVals((p) => ({ ...p, [l.id]: { ...v, note: e.target.value } }))} />
                    ) : (
                      l.note || ""
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {count.notes && <p className="hint">Notes: {count.notes}</p>}
      {editable && (
        <div className="modal-foot-row">
          <button
            type="button"
            className="btn outline warn"
            onClick={() => {
              if (!confirm("Cancel this count? Nothing is adjusted.")) return;
              cancel.mutate(count.id, { onSuccess: () => { toast("Count cancelled"); onClose(); }, onError: (e) => error(e.message) });
            }}
          >
            Cancel count
          </button>
          <button type="button" className="btn outline" onClick={() => saveThen(async () => toast("Count saved"))} disabled={saveLines.isPending}>
            Save progress
          </button>
          <button
            className="btn"
            disabled={complete.isPending || saveLines.isPending}
            onClick={() => {
              if (!confirm(`Complete ${count.count_no}? ${counted} of ${count.lines.length} lines counted, differences against what's on hand now post as adjustments; uncounted lines are left alone.`)) return;
              saveThen(async () => {
                const n = await complete.mutateAsync(count.id);
                toast(`Count completed, ${n} adjustment${n === 1 ? "" : "s"} posted`);
                onClose();
              });
            }}
          >
            Complete count
          </button>
        </div>
      )}
    </Modal>
  );
}
