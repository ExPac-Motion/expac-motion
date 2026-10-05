import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import DateInput from "../../components/DateInput";
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
import { formatDate, money } from "../../lib/format";
import {
  BASIS_LABEL,
  PERIOD_LABEL,
  billingTotals,
  computeStorageBilling,
  firstOfMonthIso,
  qty,
  todayIso,
  useWmsBillingRuns,
  useWmsMoves,
  useWmsMutation,
  useWmsReceipts,
  wmsDb,
  type WmsBillingRun,
  type WmsBillingRunInput,
} from "../../lib/wms";
import { useWmsLookups } from "./shared";

/** WMS > Warehouse Billing (Storage): storage + handling per customer per period. */
export default function WmsBilling() {
  const navigate = useNavigate();
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const runsQ = useWmsBillingRuns();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [invoicing, setInvoicing] = useState<WmsBillingRun | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const del = useWmsMutation(wmsDb.deleteBillingRun);

  const rows = runsQ.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => !q || [r.run_no, lk.clientName(r.client_id), r.invoice_no].join(" ").toLowerCase().includes(q));
  const unbilled = rows.filter((r) => r.status === "draft").reduce((s, r) => s + r.total, 0);

  const columns: DataColumn<WmsBillingRun>[] = [
    {
      key: "actions",
      header: <RowActionsHead />,
      fixed: true,
      width: 110,
      render: (r) => (
        <RowActions
          onView={() => navigate(`/wms/print/billing/${r.id}`)}
          onEdit={() => setInvoicing(r)}
          onDelete={() => {
            if (!confirm(`Delete ${r.run_no}?`)) return;
            del.mutate(r.id, { onSuccess: () => toast("Billing run deleted"), onError: (e) => error(e.message) });
          }}
        />
      ),
    },
    { key: "no", header: "Run No", width: 100, render: (r) => <b>{r.run_no}</b>, sortValue: (r) => r.run_no },
    { key: "client", header: "Customer", width: 200, render: (r) => lk.clientName(r.client_id), sortValue: (r) => lk.clientName(r.client_id) },
    { key: "wh", header: "Warehouse", width: 90, render: (r) => lk.whCode(r.warehouse_id) },
    { key: "period", header: "Period", width: 190, render: (r) => `${formatDate(r.period_from)} – ${formatDate(r.period_to)}`, sortValue: (r) => r.period_from },
    { key: "lines", header: "Lines", width: 70, render: (r) => r.lines.length },
    { key: "sub", header: "Excl. VAT", width: 120, render: (r) => money(r.subtotal), sortValue: (r) => r.subtotal },
    { key: "total", header: "Total (incl. VAT)", width: 140, render: (r) => <b>{money(r.total)}</b>, sortValue: (r) => r.total },
    {
      key: "status",
      header: "Status",
      width: 110,
      render: (r) => <span className={`badge ${r.status === "invoiced" ? "completed" : "open"}`}>{r.status === "invoiced" ? "Invoiced" : "Not invoiced"}</span>,
    },
    { key: "inv", header: "Invoice No", width: 120, render: (r) => r.invoice_no || "—" },
    { key: "invd", header: "Invoiced", width: 100, render: (r) => formatDate(r.invoiced_at) },
  ];

  return (
    <>
      <PageTools
        search={<SearchInput value={search} onChange={setSearch} placeholder="Search run, customer, invoice…" />}
        count={runsQ.isLoading ? undefined : `${filtered.length} run${filtered.length === 1 ? "" : "s"} · ${money(unbilled)} not invoiced`}
        hint="Storage is charged per day on hand after the warehouse's free days (rates in WMS > Settings); handling in / out per W/M CBM."
        onToolsSlot={setToolsSlot}
        primary={
          <button className="btn" onClick={() => setCreating(true)} disabled={lk.warehouses.length === 0}>
            + New billing run
          </button>
        }
      />
      <div className="panel">
        {runsQ.isLoading ? (
          <Loading />
        ) : runsQ.isError ? (
          <ErrorNote error={runsQ.error} />
        ) : filtered.length === 0 ? (
          <EmptyState>No billing runs yet. + New billing run works out a customer's storage for a period.</EmptyState>
        ) : (
          <DataTable
            tableKey="wms-billing"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/wms/print/billing/${r.id}`)}
          />
        )}
      </div>
      {creating && <NewRunModal onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); navigate(`/wms/print/billing/${id}`); }} />}
      {invoicing && <InvoiceModal run={invoicing} onClose={() => setInvoicing(null)} />}
    </>
  );
}

function NewRunModal({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const lk = useWmsLookups();
  const { error, toast } = useToast();
  const receiptsQ = useWmsReceipts();
  const movesQ = useWmsMoves();
  const save = useWmsMutation((v: Partial<WmsBillingRunInput>) => wmsDb.saveBillingRun(undefined, v));
  const [whId, setWhId] = useState(lk.warehouses[0]?.id ?? "");
  const [clientId, setClientId] = useState("");
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const wh = lk.warehouse(whId);

  const clientsWithReceipts = lk.clients.filter((c) => (receiptsQ.data ?? []).some((r) => r.client_id === c.id));
  const lines = useMemo(() => {
    if (!wh || !clientId || !from || !to || from > to) return [];
    const recs = (receiptsQ.data ?? []).filter((r) => r.client_id === clientId);
    return computeStorageBilling(wh, recs, movesQ.data ?? [], from, to);
  }, [wh, clientId, from, to, receiptsQ.data, movesQ.data]);
  const totals = billingTotals(lines);

  function submit() {
    if (!clientId) return error("Pick a customer");
    if (lines.length === 0) return error("Nothing to bill for this period");
    save.mutate(
      {
        client_id: clientId,
        warehouse_id: whId,
        period_from: from,
        period_to: to,
        lines,
        ...totals,
        status: "draft",
      },
      {
        onSuccess: (id) => {
          toast("Billing run saved");
          onSaved(id);
        },
        onError: (e) => error(e.message),
      },
    );
  }

  return (
    <Modal title="New storage billing run" onClose={onClose} wide stickyHeader>
      <div className="grid4">
        <div className="field">
          <label>Customer</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus>
            <option value="">—</option>
            {clientsWithReceipts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Warehouse</label>
          <select value={whId} onChange={(e) => setWhId(e.target.value)}>
            {lk.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>From</label>
          <DateInput value={from} onChange={setFrom} />
        </div>
        <div className="field">
          <label>To</label>
          <DateInput value={to} onChange={setTo} />
        </div>
      </div>
      {wh && (
        <p className="hint">
          {wh.code}: {money(wh.storage_rate)} per {BASIS_LABEL[wh.storage_basis]} per {PERIOD_LABEL[wh.storage_period]} after {wh.free_days} free day
          {wh.free_days === 1 ? "" : "s"}
          {wh.min_charge ? `, minimum ${money(wh.min_charge)} per receipt` : ""}; handling in {money(wh.handling_in_rate)} / out {money(wh.handling_out_rate)} per CBM.
          {!wh.storage_rate && !wh.handling_in_rate && !wh.handling_out_rate && " Set the rates in WMS > Settings first."}
        </p>
      )}
      {clientId && lines.length === 0 ? (
        <EmptyState>Nothing chargeable for this customer in this period.</EmptyState>
      ) : lines.length > 0 ? (
        <BillingLinesTable lines={lines} totals={totals} />
      ) : null}
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={save.isPending || lines.length === 0}>
          {save.isPending ? "Saving…" : "Save billing run"}
        </button>
      </div>
    </Modal>
  );
}

export function BillingLinesTable({
  lines,
  totals,
}: {
  lines: WmsBillingRun["lines"];
  totals: { subtotal: number; vat: number; total: number };
}) {
  return (
    <table className="table--compact wms-mini">
      <thead>
        <tr>
          <th>Code</th>
          <th>Description</th>
          <th style={{ textAlign: "right" }}>Qty</th>
          <th>Unit</th>
          <th style={{ textAlign: "right" }}>Rate</th>
          <th style={{ textAlign: "right" }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>{l.code}</td>
            <td>
              {l.description}
              {l.kind === "minimum" && <span className="hint"> (minimum charge)</span>}
            </td>
            <td style={{ textAlign: "right" }}>{qty(l.qty, 3)}</td>
            <td>{l.unit}</td>
            <td style={{ textAlign: "right" }}>{l.kind === "minimum" ? "—" : money(l.rate)}</td>
            <td style={{ textAlign: "right" }}>{money(l.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5} style={{ textAlign: "right" }}>Subtotal</td>
          <td style={{ textAlign: "right" }}>{money(totals.subtotal)}</td>
        </tr>
        <tr>
          <td colSpan={5} style={{ textAlign: "right" }}>VAT 15%</td>
          <td style={{ textAlign: "right" }}>{money(totals.vat)}</td>
        </tr>
        <tr>
          <td colSpan={5} style={{ textAlign: "right" }}>
            <b>Total</b>
          </td>
          <td style={{ textAlign: "right" }}>
            <b>{money(totals.total)}</b>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function InvoiceModal({ run, onClose }: { run: WmsBillingRun; onClose: () => void }) {
  const { toast, error } = useToast();
  const save = useWmsMutation((v: Partial<WmsBillingRunInput>) => wmsDb.saveBillingRun(run.id, v));
  const [no, setNo] = useState(run.invoice_no ?? "");
  const [date, setDate] = useState(run.invoiced_at ?? todayIso());
  const [notes, setNotes] = useState(run.notes ?? "");
  return (
    <Modal title={`${run.run_no} — invoicing`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Invoices are raised in Sage for now — record the invoice number here once it's done.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Invoice no</label>
          <input value={no} onChange={(e) => setNo(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Invoice date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="modal-foot-row">
        {run.status === "invoiced" && (
          <button
            type="button"
            className="btn outline warn"
            onClick={() =>
              save.mutate(
                { status: "draft", invoice_no: null, invoiced_at: null },
                { onSuccess: () => { toast("Marked not invoiced"); onClose(); }, onError: (e) => error(e.message) },
              )
            }
          >
            Mark not invoiced
          </button>
        )}
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { status: no.trim() ? "invoiced" : "draft", invoice_no: no.trim() || null, invoiced_at: no.trim() ? date : null, notes: notes.trim() || null },
              { onSuccess: () => { toast("Saved"); onClose(); }, onError: (e) => error(e.message) },
            )
          }
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
