import { useMemo, useState } from "react";
import DataTable, { type DataColumn } from "../../components/DataTable";
import { EmptyState, ErrorNote, Loading, PageHeader, PageTools } from "../../components/common";
import { useMySuppliers } from "../../lib/hooks";

/** "Customer Party" — the shippers used across this customer's own
 *  shipments (client_suppliers, see 0071). */
export default function PortalSuppliersPage() {
  const suppliersQ = useMySuppliers();
  const suppliers = useMemo(() => suppliersQ.data ?? [], [suppliersQ.data]);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const columns = useMemo<DataColumn<(typeof suppliers)[number]>[]>(
    () => [
      { key: "company", header: "Company", width: 240, sortValue: (r) => r.company, render: (r) => <strong>{r.company}</strong> },
      { key: "contact", header: "Contact", width: 180, sortValue: (r) => r.contact ?? "", render: (r) => r.contact || "—" },
      {
        key: "email",
        header: "Email",
        width: 240,
        sortValue: (r) => r.email ?? "",
        render: (r) => (r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : "—"),
      },
      { key: "phone", header: "Phone", width: 150, sortValue: (r) => r.phone ?? "", render: (r) => r.phone || "—" },
    ],
    [],
  );

  return (
    <>
      <PageHeader eyebrow="Your account" title="Customer Party" />
      <PageTools
        count={suppliersQ.isLoading ? undefined : `${suppliers.length} shipper${suppliers.length === 1 ? "" : "s"}`}
        onToolsSlot={setToolsSlot}
      />
      <div className="panel">
        {suppliersQ.isLoading ? (
          <Loading />
        ) : suppliersQ.isError ? (
          <ErrorNote error={suppliersQ.error} />
        ) : suppliers.length === 0 ? (
          <EmptyState>No shippers on your shipments yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="portal-suppliers"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={suppliers}
            rowKey={(r) => r.id}
          />
        )}
      </div>
    </>
  );
}
