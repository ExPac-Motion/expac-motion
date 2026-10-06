import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useMyDocumentsAll, useMyJobs } from "../../lib/hooks";
import { getMyDocumentUrl } from "../../lib/db";
import { formatDate } from "../../lib/format";

function bytesLabel(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Invoices, for now, just shipment documents staff has tagged "Invoice"
 *  and made visible to the customer (see DOCUMENT_TYPES / DocumentsSection
 *  in JobsBoard.tsx). No calculated billing yet, per the brief. */
export default function PortalInvoicesPage() {
  const docsQ = useMyDocumentsAll();
  const jobsQ = useMyJobs();
  const { error: toastError } = useToast();
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const jobById = useMemo(
    () => new Map((jobsQ.data ?? []).map((j) => [j.id, j])),
    [jobsQ.data],
  );
  const invoices = useMemo(
    () => (docsQ.data ?? []).filter((d) => d.doc_type === "Invoice"),
    [docsQ.data],
  );

  async function onDownload(storagePath: string) {
    const tab = window.open("", "_blank", "noopener");
    try {
      const url = await getMyDocumentUrl(storagePath);
      if (tab) tab.location.href = url;
    } catch (err) {
      tab?.close();
      toastError(err instanceof Error ? err.message : "Could not open document");
    }
  }

  const columns: DataColumn<(typeof invoices)[number]>[] = [
    {
      key: "invoice",
      header: "Invoice",
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
      render: (d) => jobById.get(d.job_id)?.reference ?? "—",
    },
    { key: "size", header: "Size", width: 100, sortValue: (d) => d.size_bytes ?? 0, render: (d) => bytesLabel(d.size_bytes) },
    { key: "date", header: "Date", width: 120, sortValue: (d) => d.created_at, render: (d) => formatDate(d.created_at) },
  ];

  return (
    <>
      <PageHeader eyebrow="Your account" title="Invoices" />
      <PageTools
        count={docsQ.isLoading ? undefined : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {docsQ.isLoading ? (
          <Loading />
        ) : docsQ.isError ? (
          <ErrorNote error={docsQ.error} />
        ) : invoices.length === 0 ? (
          <EmptyState>No invoices shared yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-invoices"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={invoices}
            rowKey={(d) => d.id}
          />
        )}
      </div>
    </>
  );
}
