import { useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import {
  EmptyState,
  ErrorNote,
  Loading,
  RowActions,
  RowActionsHead,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteLeadSource,
  useLeadSources,
  useSaveLeadSource,
} from "../../lib/hooks";
import type { LeadSource, LeadSourcePatch } from "../../lib/types";

export default function LeadSourcesPage() {
  const { data, isLoading, isError, error } = useLeadSources();
  const save = useSaveLeadSource();
  const remove = useDeleteLeadSource();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState<LeadSource | "new" | null>(null);

  const rows = data ?? [];
  const current = editing === "new" ? null : editing;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    if (!name) {
      toastError("Source name is required");
      return;
    }
    const patch: LeadSourcePatch = {
      name,
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

  async function onDelete(s: LeadSource) {
    if (
      !window.confirm(
        `Delete source "${s.name}"? Leads/customers already set to it keep the value — it just won't show as an option here anymore.`,
      )
    )
      return;
    try {
      await remove.mutateAsync(s.id);
      toast("Deleted");
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not delete");
    }
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Lead Sources</h2>
            <p>Options for the "Source" dropdown on Leads and Customers.</p>
          </div>
          <button className="btn" onClick={() => setEditing("new")}>
            + Add Source
          </button>
        </div>

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No sources yet.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="actions-col">
                    <RowActionsHead />
                  </th>
                  <th>Order</th>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <RowActions
                        onEdit={() => setEditing(s)}
                        onDelete={() => onDelete(s)}
                      />
                    </td>
                    <td>{s.sort_order}</td>
                    <td>
                      <strong>{s.name}</strong>
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
          title={current ? "Edit source" : "Add source"}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={onSubmit}>
            <div className="field">
              <label>Source name</label>
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
