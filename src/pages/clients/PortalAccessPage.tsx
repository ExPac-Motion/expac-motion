import { useState } from "react";
import {
  EmptyState,
  Loading,
  PageHeader,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useApprovePortalSignup,
  useClients,
  usePendingPortalSignups,
  useRejectPortalSignup,
} from "../../lib/hooks";

/**
 * Customers > Portal Access — self-serve portal signups (0068) awaiting
 * staff review. Staff picks which existing customer the request matches
 * (using the free-text company name typed at signup as a hint) and
 * approves or rejects; nothing here can be done by the signee themselves
 * (both RPCs are staff-only, see approve_portal_signup / reject_portal_signup
 * in 0068_portal_self_signup.sql).
 */
export default function PortalAccessPage() {
  const clientsQ = useClients();
  const pendingQ = usePendingPortalSignups();
  const approve = useApprovePortalSignup();
  const reject = useRejectPortalSignup();
  const { toast, error: toastError } = useToast();
  const [picked, setPicked] = useState<Record<string, string>>({});

  const clients = clientsQ.data ?? [];
  const rows = pendingQ.data ?? [];

  return (
    <>
      <PageHeader eyebrow="Customers" title="Portal Access" />
      <div className="panel">
        {pendingQ.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState>No portal signups waiting for approval.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Requested company</th>
                  <th>Match to customer</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.full_name || "—"}</td>
                    <td>{p.email || "—"}</td>
                    <td>{p.requested_company || "—"}</td>
                    <td>
                      <select
                        value={picked[p.id] ?? ""}
                        onChange={(e) =>
                          setPicked((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      >
                        <option value="">— select customer —</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.company}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="row-icons">
                      <button
                        className="btn btn-sm"
                        disabled={!picked[p.id] || approve.isPending}
                        onClick={async () => {
                          try {
                            await approve.mutateAsync({
                              profileId: p.id,
                              clientId: picked[p.id],
                            });
                            toast("Portal access approved");
                          } catch (e) {
                            toastError(
                              e instanceof Error ? e.message : "Could not approve",
                            );
                          }
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn outline btn-sm"
                        disabled={reject.isPending}
                        onClick={async () => {
                          try {
                            await reject.mutateAsync(p.id);
                            toast("Signup rejected");
                          } catch (e) {
                            toastError(
                              e instanceof Error ? e.message : "Could not reject",
                            );
                          }
                        }}
                      >
                        Reject
                      </button>
                    </td>
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
