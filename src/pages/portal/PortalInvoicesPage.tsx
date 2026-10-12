import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools } from "../../components/common";
import { AccountSummary, InvoiceTable, StatementButton } from "../../components/SageAccount";
import { useToast } from "../../components/Toast";
import { useMyDocumentsAll, useMyJobs } from "../../lib/hooks";
import { getMyDocumentUrl } from "../../lib/db";
import { formatDate, formatDateTime } from "../../lib/format";
import { invoiceStatus, useCustomerInvoices, useMySageAccount, type InvoiceStatus } from "../../lib/sage";

function bytesLabel(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FILTERS: ("All" | "Outstanding" | InvoiceStatus)[] = ["All", "Outstanding", "Overdue", "Paid"];

/** Invoices: the customer's account from Sage Accounting (0156), amounts,
 *  due dates, statuses, ageing, each invoice's PDF and a Statement of
 *  Account, plus the invoice documents staff shared on shipments. */
export default function PortalInvoicesPage() {
  const docsQ = useMyDocumentsAll();
  const jobsQ = useMyJobs();
  const invQ = useCustomerInvoices();
  const accountQ = useMySageAccount();
  const { error: toastError } = useToast();
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const jobById = useMemo(
    () => new Map((jobsQ.data ?? []).map((j) => [j.id, j])),
    [jobsQ.data],
  );
  const shipments = useMemo(
    () => new Map((jobsQ.data ?? []).map((j) => [j.id, j.reference])),
    [jobsQ.data],
  );
  const documents = useMemo(
    () => (docsQ.data ?? []).filter((d) => d.doc_type === "Invoice"),
    [docsQ.data],
  );
  const invoices = invQ.data ?? [];
  const account = accountQ.data;
  // Not linked to Sage (or Sage not set up): the shared invoice documents only.
  const linked = !!account || invoices.length > 0;
  const shown = invoices.filter((i) => {
    if (filter === "All") return true;
    const s = invoiceStatus(i);
    if (filter === "Outstanding") return s !== "Paid";
    return s === filter;
  });

  async function onDownload(storagePath: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await getMyDocumentUrl(storagePath);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      toastError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  const docColumns: DataColumn<(typeof documents)[number]>[] = [
    {
      key: "invoice",
      header: "Document",
      width: 280,
      sortValue: (d) => d.name,
      render: (d) => (
        <button
          type="button"
          className="btn ghost small"
          style={{ textAlign: "left" }}
          onClick={() => onDownload(d.storage_path)}
        >
          {d.name}
        </button>
      ),
    },
    {
      key: "shipment",
      header: "Shipment",
      width: 150,
      sortValue: (d) => jobById.get(d.job_id)?.reference ?? "",
      render: (d) => jobById.get(d.job_id)?.reference ?? "",
    },
    { key: "size", header: "Size", width: 100, sortValue: (d) => d.size_bytes ?? 0, render: (d) => bytesLabel(d.size_bytes) },
    { key: "date", header: "Date", width: 120, sortValue: (d) => d.created_at, render: (d) => formatDate(d.created_at) },
  ];

  return (
    <>
      <PageHeader eyebrow="Your account" title="Invoices" />
      <PageTools
        count={invQ.isLoading ? undefined : linked ? `${shown.length} invoice${shown.length === 1 ? "" : "s"}` : `${documents.length} invoice${documents.length === 1 ? "" : "s"}`}
        filters={
          linked ? (
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show">
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          ) : undefined
        }
        primary={account ? <StatementButton /> : undefined}
        onToolsSlot={setToolsSlot}
      />

      {invQ.isLoading || accountQ.isLoading ? (
        <div className="panel">
          <Loading />
        </div>
      ) : linked ? (
        <div className="panel">
          <AccountSummary invoices={invoices} balance={account?.balance} />
          {shown.length === 0 ? (
            <EmptyState>No {filter === "All" ? "" : filter.toLowerCase() + " "}invoices.</EmptyState>
          ) : (
            <InvoiceTable
              invoices={shown}
              tableKey="portal-sage-invoices"
              toolsPortal={toolsSlot}
              shipments={shipments}
              shipmentLink={(id) => ({ to: `/portal/shipments/${id}` })}
            />
          )}
          {account?.synced_at && (
            <p className="hint" style={{ marginTop: 8 }}>
              From ExPac's accounts, updated {formatDateTime(account.synced_at)}. Click an invoice number for its PDF.
            </p>
          )}
        </div>
      ) : null}

      {(documents.length > 0 || !linked) && (
        <div className="panel">
          {linked && (
            <div className="panel-head">
              <h2>Invoice documents on your shipments</h2>
            </div>
          )}
          {docsQ.isLoading ? (
            <Loading />
          ) : docsQ.isError ? (
            <ErrorNote error={docsQ.error} />
          ) : documents.length === 0 ? (
            <EmptyState>No invoices shared yet.</EmptyState>
          ) : (
            <DataTable
              tableKey="portal-invoices"
              className="table--compact"
              toolsPortal={linked ? undefined : toolsSlot}
              columns={docColumns}
              rows={documents}
              rowKey={(d) => d.id}
            />
          )}
        </div>
      )}
    </>
  );
}
