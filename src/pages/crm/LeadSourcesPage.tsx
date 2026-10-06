import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  useRowSelection,
  CanDelete,
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

  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const rows = useMemo(() => data ?? [], [data]);
  const current = editing === "new" ? null : editing;
  const sel = useRowSelection(rows);

  const columns = useMemo<DataColumn<LeadSource>[]>(
    () => [
      {
        key: "actions",
        fixed: true,
        width: 150,
        header: (
          <RowActionsHead
            checked={sel.allChecked}
            indeterminate={sel.someChecked}
            onToggle={sel.toggleAll}
          />
        ),
        render: (s) => (
          <RowActions
            selected={sel.isSelected(s.id)}
            onSelectToggle={() => sel.toggle(s.id)}
            onEdit={() => setEditing(s)}
            onDelete={() => onDelete(s)}
          />
        ),
      },
      { key: "order", header: "Order", width: 90, sortValue: (s) => s.sort_order, render: (s) => s.sort_order },
      {
        key: "name",
        header: "Name",
        width: 280,
        sortValue: (s) => s.name,
        render: (s) => <strong>{s.name}</strong>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel],
  );

  async function onBulkDelete() {
    if (
      !window.confirm(
        `Delete ${sel.count} source${sel.count === 1 ? "" : "s"}? Leads/customers already set to them keep the value, they just won't show as options anymore.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      for (const id of sel.ids) await remove.mutateAsync(id);
      toast(`Deleted ${sel.count} source${sel.count === 1 ? "" : "s"}`);
      sel.clear();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not delete");
    } finally {
      setBulkBusy(false);
    }
  }

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
        `Delete source "${s.name}"? Leads/customers already set to it keep the value, it just won't show as an option here anymore.`,
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
      <PageTools
        onToolsSlot={setToolsSlot}
        count={isLoading ? undefined : `${rows.length} source${rows.length === 1 ? "" : "s"}`}
        hint={'Options for the "Source" dropdown on Leads and Customers.'}
        primary={
          <button className="btn" onClick={() => setEditing("new")}>
            + Add Source
          </button>
        }
      >
        <CanDelete>
        <button
          className="btn danger"
          onClick={onBulkDelete}
          disabled={sel.count === 0 || bulkBusy}
          title={sel.count === 0 ? "Tick rows in the Actions column to delete" : undefined}
        >
          Delete{sel.count ? ` (${sel.count})` : ""}
        </button>
        </CanDelete>
      </PageTools>

      <div className="panel">

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No sources yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="lead-sources"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
          />
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
