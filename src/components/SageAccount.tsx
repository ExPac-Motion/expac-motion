// Sage Accounting invoices (0156), shared by Customers › <customer> ›
// Invoices & Account and the Customer Portal's Invoices page: the account
// summary (balance, outstanding, overdue, ageing) and the invoice table.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import DataTable, { type DataColumn } from "./DataTable";
import DateInput from "./DateInput";
import { Popover } from "./common";
import { useToast } from "./Toast";
import { formatDate, money } from "../lib/format";
import {
  ageing,
  daysOverdue,
  invoiceStatus,
  openSagePdf,
  todayIso,
  type CustomerInvoice,
  type InvoiceStatus,
} from "../lib/sage";

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  Paid: "inv-paid",
  "Partially paid": "inv-part",
  Due: "inv-due",
  Overdue: "inv-overdue",
};

export function InvoiceStatusBadge({ invoice }: { invoice: CustomerInvoice }) {
  const s = invoiceStatus(invoice);
  const d = s === "Overdue" ? daysOverdue(invoice) : 0;
  return (
    <span className={`badge ${STATUS_CLASS[s]}`}>
      {s}
      {d ? ` · ${d}d` : ""}
    </span>
  );
}

/** Balance / outstanding / overdue tiles plus the ageing strip. */
export function AccountSummary({
  invoices,
  balance,
  actions,
}: {
  invoices: CustomerInvoice[];
  /** The Sage account balance (includes credit notes and unallocated receipts). */
  balance?: number | null;
  actions?: ReactNode;
}) {
  const today = todayIso();
  const owing = invoices.filter((i) => invoiceStatus(i, today) !== "Paid");
  const overdue = owing.filter((i) => invoiceStatus(i, today) === "Overdue");
  const sum = (xs: CustomerInvoice[]) => xs.reduce((s, i) => s + (Number(i.amount_due) || 0), 0);
  const buckets = ageing(invoices, today);
  const owed = sum(owing);
  return (
    <div className="sage-summary">
      <div className="sage-tiles">
        {balance != null && (
          <div className="sage-tile">
            <span>Account balance</span>
            <b>{money(balance)}</b>
          </div>
        )}
        <div className="sage-tile">
          <span>Outstanding</span>
          <b>{money(owed)}</b>
          <em>
            {owing.length} invoice{owing.length === 1 ? "" : "s"}
          </em>
        </div>
        <div className={`sage-tile${overdue.length ? " overdue" : ""}`}>
          <span>Overdue</span>
          <b>{money(sum(overdue))}</b>
          <em>
            {overdue.length} invoice{overdue.length === 1 ? "" : "s"}
          </em>
        </div>
        {actions && <div className="sage-tile-actions">{actions}</div>}
      </div>
      <div className="sage-ageing" aria-label="Ageing by days overdue">
        {buckets.map((b, i) => (
          <div key={b.label} className={`sage-age${b.amount > 0 && i >= 3 ? " late" : ""}`}>
            <span>{b.label}</span>
            <b>{money(b.amount)}</b>
            <div className="sage-age-bar">
              <i style={{ width: owed > 0 ? `${Math.round((b.amount / owed) * 100)}%` : 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The invoices, newest first, with each one's PDF from Sage. */
export function InvoiceTable({
  invoices,
  tableKey,
  toolsPortal,
  shipments,
  shipmentLink,
}: {
  invoices: CustomerInvoice[];
  tableKey: string;
  toolsPortal?: HTMLDivElement | null;
  /** job id → shipment number */
  shipments: Map<string, string>;
  shipmentLink: (jobId: string) => { to: string; state?: unknown };
}) {
  const { error } = useToast();
  async function open(i: CustomerInvoice) {
    try {
      await openSagePdf({ invoice: i.sage_id });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not open the invoice");
    }
  }
  const columns: DataColumn<CustomerInvoice>[] = [
    {
      key: "invoice",
      header: "Invoice No",
      width: 120,
      sortValue: (i) => i.document_number ?? "",
      render: (i) => (
        <button type="button" className="btn ghost small" style={{ textAlign: "left" }} onClick={() => open(i)}>
          {i.document_number || `#${i.sage_id}`}
        </button>
      ),
    },
    {
      key: "shipment",
      header: "Shipment No",
      width: 120,
      sortValue: (i) => (i.job_id ? shipments.get(i.job_id) ?? "" : i.reference ?? ""),
      render: (i) =>
        i.job_id && shipments.get(i.job_id) ? (
          <Link {...shipmentLink(i.job_id)}>{shipments.get(i.job_id)}</Link>
        ) : (
          i.reference || ""
        ),
    },
    { key: "date", header: "Date", width: 100, sortValue: (i) => i.invoice_date ?? "", render: (i) => formatDate(i.invoice_date) },
    { key: "due", header: "Due Date", width: 100, sortValue: (i) => i.due_date ?? "", render: (i) => formatDate(i.due_date) },
    {
      key: "total",
      header: "Total (incl. VAT)",
      width: 130,
      cellClass: "sage-num",
      sortValue: (i) => Number(i.total) || 0,
      render: (i) => money(i.total),
    },
    {
      key: "amount_due",
      header: "Amount Due",
      width: 120,
      cellClass: "sage-num",
      sortValue: (i) => Number(i.amount_due) || 0,
      render: (i) => money(i.amount_due),
    },
    {
      key: "status",
      header: "Status",
      width: 130,
      sortValue: (i) => invoiceStatus(i),
      render: (i) => <InvoiceStatusBadge invoice={i} />,
    },
  ];
  return (
    <DataTable
      tableKey={tableKey}
      className="table--compact"
      toolsPortal={toolsPortal}
      columns={columns}
      rows={invoices}
      rowKey={(i) => String(i.sage_id)}
    />
  );
}

/** Statement of Account PDF from Sage for a period (default: the last 12
 *  months). Staff pass the customer; a portal login gets its own. */
export function StatementButton({ clientId }: { clientId?: string }) {
  const { error } = useToast();
  const today = todayIso();
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  async function go(close: () => void) {
    setBusy(true);
    try {
      await openSagePdf({ statement: true, client: clientId, from, to });
      close();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not get the statement");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover label="Statement of Account" size="md">
      {(close) => (
        <div style={{ display: "grid", gap: 8, padding: 4, minWidth: 220 }}>
          <label className="field" style={{ margin: 0 }}>
            <span>From</span>
            <DateInput value={from} onChange={setFrom} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>To</span>
            <DateInput value={to} onChange={setTo} />
          </label>
          <button type="button" className="btn" disabled={busy || !from || !to} onClick={() => go(close)}>
            {busy ? "Getting it from Sage…" : "Download PDF"}
          </button>
        </div>
      )}
    </Popover>
  );
}
