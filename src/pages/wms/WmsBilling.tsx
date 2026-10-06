import { useMemo, useState, type ReactNode } from "react";
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
  SERVICE_STATUS,
  updateService,
  useWmsServices,
  type WmsBillingLine,
  type WmsServiceRequest,
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
  const [tab, setTab] = useState<"runs" | "services">("runs");
  const toggle = (
    <div className="wms-seg">
      <button type="button" className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}>
        Billing runs
      </button>
      <button type="button" className={tab === "services" ? "active" : ""} onClick={() => setTab("services")}>
        Service requests
      </button>
    </div>
  );
  return tab === "runs" ? <BillingRuns toggle={toggle} /> : <ServiceRequests toggle={toggle} />;
}

function BillingRuns({ toggle }: { toggle: ReactNode }) {
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
        filters={toggle}
        count={runsQ.isLoading ? undefined : `${filtered.length} run${filtered.length === 1 ? "" : "s"} · ${money(unbilled)} not invoiced`}
        hint="Storage is charged per day on hand after the warehouse's free days (rates in Motion WMS > Settings); handling in / out per W/M CBM."
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
  // Done service requests (0150) not billed yet, completed by the period end.
  const servicesQ = useWmsServices();
  const svc = useMemo(
    () =>
      (servicesQ.data ?? []).filter(
        (x) => x.client_id === clientId && x.status === "done" && !x.billed_run_id && x.charge_amount != null && (x.completed_at ?? "").slice(0, 10) <= to,
      ),
    [servicesQ.data, clientId, to],
  );
  const lines = useMemo(() => {
    if (!wh || !clientId || !from || !to || from > to) return [];
    const recs = (receiptsQ.data ?? []).filter((r) => r.client_id === clientId);
    const storage = computeStorageBilling(wh, recs, movesQ.data ?? [], from, to);
    const services: WmsBillingLine[] = svc.map((x) => ({
      receipt_id: x.receipt_ids[0] ?? "",
      receipt_no: x.service_no,
      description: x.service + (x.qty != null ? " x " + x.qty : "") + " (" + x.service_no + ")",
      kind: "service",
      code: x.charge_code || "WH-03",
      qty: 1,
      unit: "Service",
      rate: x.charge_amount ?? 0,
      amount: x.charge_amount ?? 0,
    }));
    return [...storage, ...services];
  }, [wh, clientId, from, to, receiptsQ.data, movesQ.data, svc]);
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
        onSuccess: async (id) => {
          // Services on this run are billed now.
          for (const x of svc) await updateService(x, { billed_run_id: id });
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
                {w.code}, {w.name}
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
          {!wh.storage_rate && !wh.handling_in_rate && !wh.handling_out_rate && " Set the rates in Motion WMS > Settings first."}
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
    <Modal title={`${run.run_no}, invoicing`} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Invoices are raised in Sage for now, record the invoice number here once it's done.
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

/* ---------- Service requests from the portal (0150) ---------- */

function ServiceRequests({ toggle }: { toggle: ReactNode }) {
  const lk = useWmsLookups();
  const { toast, error } = useToast();
  const q = useWmsServices();
  const receiptsQ = useWmsReceipts();
  const [showAll, setShowAll] = useState(false);
  const [doneFor, setDoneFor] = useState<WmsServiceRequest | null>(null);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const recNo = new Map((receiptsQ.data ?? []).map((r) => [r.id, r.receipt_no]));
  const rows = (q.data ?? []).filter((x) => showAll || x.status === "requested" || x.status === "in_progress");

  async function set(x: WmsServiceRequest, patch: Partial<WmsServiceRequest>, msg: string) {
    try {
      await updateService(x, patch);
      toast(msg);
      q.refetch();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update");
    }
  }

  const columns: DataColumn<WmsServiceRequest>[] = [
    {
      key: "act",
      header: "Actions",
      fixed: true,
      width: 220,
      render: (x) =>
        x.status === "requested" || x.status === "in_progress" ? (
          <div style={{ display: "flex", gap: 6 }}>
            {x.status === "requested" && (
              <button className="btn outline btn-sm" onClick={() => void set(x, { status: "in_progress" }, "Marked in progress")}>
                Start
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setDoneFor(x)}>
              Done
            </button>
            <button
              className="btn outline warn btn-sm"
              onClick={() => {
                const why = prompt("Decline " + x.service_no + "? Tell the customer why:");
                if (why !== null) void set(x, { status: "declined", staff_note: why.trim() || null }, "Declined");
              }}
            >
              Decline
            </button>
          </div>
        ) : (
          <span className={"badge " + SERVICE_STATUS[x.status].cls}>{SERVICE_STATUS[x.status].label}</span>
        ),
    },
    { key: "no", header: "Request No", width: 110, render: (x) => <b>{x.service_no}</b>, sortValue: (x) => x.service_no },
    { key: "client", header: "Customer", width: 180, render: (x) => lk.clientName(x.client_id), sortValue: (x) => lk.clientName(x.client_id) },
    { key: "service", header: "Service", width: 170, render: (x) => x.service },
    { key: "qty", header: "Qty", width: 70, render: (x) => (x.qty == null ? "—" : String(x.qty)) },
    { key: "receipts", header: "Receipts", width: 180, render: (x) => x.receipt_ids.map((id) => recNo.get(id) ?? "?").join(", ") || "—" },
    { key: "needed", header: "Needed by", width: 100, render: (x) => formatDate(x.required_date), sortValue: (x) => x.required_date ?? "" },
    { key: "notes", header: "Instructions", width: 240, render: (x) => x.notes || "—" },
    {
      key: "charge",
      header: "Charge",
      width: 150,
      render: (x) => (x.charge_amount != null ? money(x.charge_amount) + (x.billed_run_id ? " · billed" : "") : "—"),
    },
  ];

  return (
    <>
      <PageTools
        filters={
          <>
            {toggle}
            <label className="check" style={{ margin: 0 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show done / declined
            </label>
          </>
        }
        count={q.isLoading ? undefined : rows.length + " request" + (rows.length === 1 ? "" : "s")}
        hint="Customers ask for warehouse services on the portal. Done charges go on their next storage billing run."
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {q.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState>{showAll ? "No service requests yet." : "No open service requests."}</EmptyState>
        ) : (
          <DataTable tableKey="wms-services" className="table--compact" toolsPortal={toolsSlot} columns={columns} rows={rows} rowKey={(x) => x.id} />
        )}
      </div>
      {doneFor && (
        <ServiceDoneModal
          req={doneFor}
          onClose={() => setDoneFor(null)}
          onSave={(patch) => {
            void set(doneFor, { ...patch, status: "done", completed_at: new Date().toISOString() }, "Service done, the charge goes on the next billing run");
            setDoneFor(null);
          }}
        />
      )}
    </>
  );
}

function ServiceDoneModal({
  req,
  onClose,
  onSave,
}: {
  req: WmsServiceRequest;
  onClose: () => void;
  onSave: (patch: Partial<WmsServiceRequest>) => void;
}) {
  const [code, setCode] = useState(req.charge_code ?? "WH-03");
  const [amount, setAmount] = useState(req.charge_amount != null ? String(req.charge_amount) : "");
  const [note, setNote] = useState(req.staff_note ?? "");
  return (
    <Modal title={"Service done, " + req.service_no} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        {req.service}
        {req.qty != null ? " x " + req.qty : ""}. Leave the charge blank for no charge.
      </p>
      <div className="grid2">
        <div className="field">
          <label>Charge code</label>
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="WH-03">WH-03 Packaging and Palletizing</option>
            <option value="WH-02">WH-02 Handling In/Out</option>
            <option value="WH-01">WH-01 Warehousing and Storage</option>
          </select>
        </div>
        <div className="field">
          <label>Charge excl. VAT (R)</label>
          <input type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="field">
        <label>Note to the customer</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. 24 cartons labelled" />
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={() => onSave({ charge_code: code, charge_amount: amount === "" ? null : Number(amount), staff_note: note.trim() || null })}
        >
          Mark done
        </button>
      </div>
    </Modal>
  );
}
