import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
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

/** Invoices — for now, just shipment documents staff has tagged "Invoice"
 *  and made visible to the customer (see DOCUMENT_TYPES / DocumentsSection
 *  in JobsBoard.tsx). No calculated billing yet, per the brief. */
export default function PortalInvoicesPage() {
  const docsQ = useMyDocumentsAll();
  const jobsQ = useMyJobs();
  const { error: toastError } = useToast();
  const jobById = new Map((jobsQ.data ?? []).map((j) => [j.id, j]));
  const invoices = (docsQ.data ?? []).filter((d) => d.doc_type === "Invoice");

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

  return (
    <>
      <PageHeader eyebrow="Your account" title="Invoices" />
      <div className="panel">
        {docsQ.isLoading ? (
          <Loading />
        ) : docsQ.isError ? (
          <ErrorNote error={docsQ.error} />
        ) : invoices.length === 0 ? (
          <EmptyState>No invoices shared yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Shipment</th>
                  <th>Size</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ textAlign: "left" }}
                        onClick={() => onDownload(d.storage_path)}
                      >
                        {d.name}
                      </button>
                    </td>
                    <td>{jobById.get(d.job_id)?.reference ?? "—"}</td>
                    <td>{bytesLabel(d.size_bytes)}</td>
                    <td>{formatDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
