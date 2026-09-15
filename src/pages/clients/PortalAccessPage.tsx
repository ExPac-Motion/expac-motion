import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EmptyState,
  Loading,
  PageHeader,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useApprovePortalSignup,
  useClients,
  useMyProfile,
  usePendingPortalSignups,
  usePortalUsers,
  useRejectPortalSignup,
  useRestorePortalAccess,
  useRevokePortalAccess,
  useSendPortalPasswordReset,
  useSetPortalPermissions,
  useUpdateProfile,
} from "../../lib/hooks";
import { formatDateTime } from "../../lib/format";
import type { Profile } from "../../lib/types";

const PERMISSION_LABELS: { key: keyof Profile["portal_permissions"]; label: string }[] = [
  { key: "shipments", label: "Shipments" },
  { key: "quotes", label: "Quotes" },
  { key: "invoices", label: "Invoices" },
  { key: "suppliers", label: "Customer Party" },
  { key: "rates", label: "Tariff Sheet" },
  { key: "messaging", label: "Messaging" },
];

/**
 * Customers > Portal Access. Admin-only (every action here calls an
 * is_admin()-gated RPC — see 0091_role_model_v2.sql): self-serve signups
 * (0068) awaiting review, plus every active/revoked portal login with its
 * own settings — permissions, last login, revoke/restore, and a
 * "send password reset" trigger (staff never sees or sets a customer's
 * password directly, only asks Supabase to email them a reset link).
 */
export default function PortalAccessPage() {
  const myProfileQ = useMyProfile();

  if (myProfileQ.isLoading) return <Loading />;
  if (myProfileQ.data?.role !== "admin") {
    return (
      <>
        <PageHeader eyebrow="Customers" title="Portal Access" />
        <div className="panel">
          <EmptyState>
            Only Admin can manage portal access and user permissions.
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Customers" title="Portal Access" />
      <PendingSignups />
      <ActivePortalUsers />
    </>
  );
}

function PendingSignups() {
  const clientsQ = useClients();
  const pendingQ = usePendingPortalSignups();
  const approve = useApprovePortalSignup();
  const reject = useRejectPortalSignup();
  const { toast, error: toastError } = useToast();
  const [picked, setPicked] = useState<Record<string, string>>({});

  const clients = clientsQ.data ?? [];
  const rows = pendingQ.data ?? [];

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Awaiting approval</h3>
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
  );
}

function ActivePortalUsers() {
  const usersQ = usePortalUsers();
  const revoke = useRevokePortalAccess();
  const restore = useRestorePortalAccess();
  const setPermissions = useSetPortalPermissions();
  const sendReset = useSendPortalPasswordReset();
  const updateProfile = useUpdateProfile();
  const navigate = useNavigate();
  const { toast, error: toastError } = useToast();
  const [editingName, setEditingName] = useState<string | null>(null);

  // Approved/restricted only — pending self-serve requests are handled
  // above, in the "Awaiting approval" table.
  const rows = (usersQ.data ?? []).filter(
    (u) => u.role === "client" || u.role === "restricted",
  );

  async function onRename(id: string, full_name: string) {
    try {
      await updateProfile.mutateAsync({ id, patch: { full_name } });
      toast("Name updated");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update name");
    } finally {
      setEditingName(null);
    }
  }

  function onOpenCustomer(clientId: string | null) {
    if (!clientId) return;
    navigate("/clients", { state: { openContactId: clientId } });
  }

  async function onTogglePermission(
    profileId: string,
    current: Profile["portal_permissions"],
    key: keyof Profile["portal_permissions"],
  ) {
    try {
      await setPermissions.mutateAsync({
        profileId,
        permissions: { ...current, [key]: !current[key] },
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not update permissions");
    }
  }

  async function onRevoke(id: string, name: string) {
    if (!window.confirm(`Revoke portal access for ${name}? They'll be signed out of everything until you restore it.`)) {
      return;
    }
    try {
      await revoke.mutateAsync(id);
      toast("Portal access revoked");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not revoke access");
    }
  }

  async function onRestore(id: string) {
    try {
      await restore.mutateAsync(id);
      toast("Portal access restored");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not restore access");
    }
  }

  async function onSendReset(email: string | null) {
    if (!email) {
      toastError("This login has no email on file");
      return;
    }
    try {
      await sendReset.mutateAsync(email);
      toast(`Password reset email sent to ${email}`);
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Could not send reset email");
    }
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Portal users</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Every customer login, active or revoked. Toggle which sections of
        the portal a login can see, send them a password-reset email, or
        revoke access entirely — reversible any time.
      </p>
      {usersQ.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>No portal users yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table--compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Permissions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    {editingName === u.id ? (
                      <input
                        autoFocus
                        defaultValue={u.full_name ?? ""}
                        onBlur={(e) => onRename(u.id, e.target.value.trim())}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingName(null);
                        }}
                      />
                    ) : (
                      <button
                        className="btn ghost small"
                        onClick={() => setEditingName(u.id)}
                      >
                        {u.full_name || "—"}
                      </button>
                    )}
                  </td>
                  <td>{u.email || "—"}</td>
                  <td>
                    {u.company ? (
                      <button
                        className="btn ghost small"
                        onClick={() => onOpenCustomer(u.client_id)}
                      >
                        {u.company}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {u.role === "restricted" ? (
                      <span className="tag" style={{ background: "#f4dede", color: "#8a2c2c" }}>
                        Revoked
                      </span>
                    ) : (
                      <span className="tag">Active</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "Never"}
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                      {PERMISSION_LABELS.map(({ key, label }) => (
                        <label
                          key={key}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: "0.76rem",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={u.portal_permissions[key]}
                            onChange={() =>
                              onTogglePermission(u.id, u.portal_permissions, key)
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="row-icons">
                    <button
                      className="btn outline btn-sm"
                      disabled={sendReset.isPending}
                      onClick={() => onSendReset(u.email)}
                    >
                      Send reset
                    </button>
                    {u.role === "restricted" ? (
                      <button
                        className="btn btn-sm"
                        disabled={restore.isPending}
                        onClick={() => onRestore(u.id)}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        className="btn outline btn-sm"
                        disabled={revoke.isPending}
                        onClick={() => onRevoke(u.id, u.full_name || u.email || "this user")}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
