import { EmptyState, ErrorNote, Loading, PageHeader } from "../../components/common";
import { useMySuppliers } from "../../lib/hooks";

/** "Customer Party" — the shippers used across this customer's own
 *  shipments (client_suppliers, see 0071). */
export default function PortalSuppliersPage() {
  const suppliersQ = useMySuppliers();
  const suppliers = suppliersQ.data ?? [];

  return (
    <>
      <PageHeader eyebrow="Your account" title="Customer Party" />
      <div className="panel">
        {suppliersQ.isLoading ? (
          <Loading />
        ) : suppliersQ.isError ? (
          <ErrorNote error={suppliersQ.error} />
        ) : suppliers.length === 0 ? (
          <EmptyState>No shippers on your shipments yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.company}</strong>
                    </td>
                    <td>{s.contact || "—"}</td>
                    <td>
                      {s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : "—"}
                    </td>
                    <td>{s.phone || "—"}</td>
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
