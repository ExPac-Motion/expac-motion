import { useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import { EmptyState, ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import { useDeleteLeadStatus, useLeadStatuses, useSaveLeadStatus } from "../../lib/hooks";
import type { LeadStatus, LeadStatusPatch } from "../../lib/types";

export default function LeadStatusesPage() {
  const { data, isLoading, isError, error } = useLeadStatuses();
  const save = useSaveLeadStatus();
  const remove = useDeleteLeadStatus();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState<LeadStatus | "new" | null>(null);

  const rows = data ?? [];
  const current = editing === "new" ? null : editing;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) {
      toastError("Status name is required");
      return;
    }
    const patch: LeadStatusPatch = {
      name,
      promotes_to_customer: fd.get("promotes_to_customer") === "on",
      sort_order: Number(fd.get("sort_order")) || 0,
    };
    try {
      await save.mutateAsync({
        id: editing && editing !== "new" ? editing.id : undefined,
        patch,
      });
      setEditing(null);
      toast("Saved");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  async function onDelete(row: LeadStatus) {
    if (!window.confirm(`Remove status "${row.name}"?`)) return;
    try {
      await remove.mutateAsync(row.id);
      toast("Status removed");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not remove — leads may still use it");
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Lead Statuses</h2>
            <p>
              Setting a lead to a status flagged "promotes to customer" automatically
              creates a real customer record.
            </p>
          </div>
          <button className="btn" onClick={() => setEditing("new")}>
            + Add Status
          </button>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No statuses yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>Promotes to Customer</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>{s.sort_order}</td>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>{s.promotes_to_customer ? "Yes" : "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="btn ghost small"
                          onClick={() => setEditing(s)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn ghost small"
                          onClick={() => onDelete(s)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <Modal
          title={current ? "Edit status" : "Add status"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Status name</label>
              <input name="name" defaultValue={current?.name ?? ""} autoFocus />
            </div>
            <div className="field">
              <label>Sort order</label>
              <input
                name="sort_order"
                type="number"
                defaultValue={current?.sort_order ?? rows.length + 1}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="promotes_to_customer"
                defaultChecked={Boolean(current?.promotes_to_customer)}
              />
              Setting a lead to this status promotes them to a Customer
            </label>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
