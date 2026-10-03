import { useMemo, useState, type FormEvent } from "react";
import Modal from "../../components/Modal";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  useRowSelection,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { useLeadStatuses, useSaveLeadStatus } from "../../lib/hooks";
import type { LeadStatus, LeadStatusPatch } from "../../lib/types";

export default function LeadStatusesPage() {
  const { data, isLoading, isError, error } = useLeadStatuses();
  const save = useSaveLeadStatus();
  const { toast, error: toastError } = useToast();
  const [editing, setEditing] = useState<LeadStatus | "new" | null>(null);
  const [viewing, setViewing] = useState<LeadStatus | null>(null);

  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const rows = useMemo(() => data ?? [], [data]);
  const current = editing === "new" ? null : editing;
  const sel = useRowSelection(rows);

  const columns = useMemo<DataColumn<LeadStatus>[]>(
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
            onView={() => setViewing(s)}
            onEdit={() => setEditing(s)}
          />
        ),
      },
      { key: "order", header: "Order", width: 90, sortValue: (s) => s.sort_order, render: (s) => s.sort_order },
      {
        key: "colour",
        header: "Colour",
        width: 90,
        render: (s) => (
          <span className="ls-swatch" style={{ background: s.color }} title={s.color} />
        ),
      },
      {
        key: "name",
        header: "Name",
        width: 240,
        sortValue: (s) => s.name,
        render: (s) => <strong>{s.name}</strong>,
      },
      {
        key: "promotes",
        header: "Promotes to Customer",
        width: 190,
        sortValue: (s) => (s.promotes_to_customer ? 1 : 0),
        render: (s) => (s.promotes_to_customer ? "Yes" : "—"),
      },
    ],
    [sel],
  );

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
      color: String(fd.get("color") || "#64748b"),
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

  return (
    <>
      <PageTools
        onToolsSlot={setToolsSlot}
        count={isLoading ? undefined : `${rows.length} status${rows.length === 1 ? "" : "es"}`}
        hint={'Setting a lead to a status flagged "promotes to customer" automatically creates a real customer record.'}
        primary={
          <button className="btn" onClick={() => setEditing("new")}>
            + Add Status
          </button>
        }
      >
        <button
          className="btn outline"
          onClick={() => setBulkOpen(true)}
          disabled={sel.count === 0}
          title={sel.count === 0 ? "Tick rows in the Actions column to bulk edit" : undefined}
        >
          Bulk Edit{sel.count ? ` (${sel.count})` : ""}
        </button>
      </PageTools>

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} status${sel.count === 1 ? "" : "es"}`}
          count={sel.count}
          noun="status"
          busy={bulkBusy}
          fields={[
            { key: "color", label: "Colour (hex)", type: "text", placeholder: "#64748b", allowClear: false },
            {
              key: "promotes_to_customer",
              label: "Promotes to Customer",
              type: "toggle",
              onLabel: "Yes",
              offLabel: "No",
            },
            { key: "sort_order", label: "Sort order", type: "number", allowClear: false },
          ]}
          onApply={async (patch) => {
            setBulkBusy(true);
            try {
              for (const id of sel.ids) {
                await save.mutateAsync({ id, patch: patch as LeadStatusPatch });
              }
              toast(`Updated ${sel.count} status${sel.count === 1 ? "" : "es"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e2) {
              toastError(e2 instanceof Error ? e2.message : "Bulk edit failed");
            } finally {
              setBulkBusy(false);
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      <div className="panel">

        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorNote error={error} />
        ) : rows.length === 0 ? (
          <EmptyState>No statuses yet.</EmptyState>
        ) : (
          <DataTable
            tableKey="lead-statuses"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
          />
        )}
      </div>

      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)}>
          <div className="field">
            <label>Colour</label>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
              }}
            >
              <span
                className="ls-swatch"
                style={{ background: viewing.color }}
              />
              {viewing.color}
            </span>
          </div>
          <div className="field">
            <label>Sort order</label>
            <strong>{viewing.sort_order}</strong>
          </div>
          <div className="field">
            <label>Promotes a lead to a Customer</label>
            <strong>{viewing.promotes_to_customer ? "Yes" : "No"}</strong>
          </div>
        </Modal>
      )}

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
            <div className="grid2">
              <div className="field">
                <label>Sort order</label>
                <input
                  name="sort_order"
                  type="number"
                  defaultValue={current?.sort_order ?? rows.length + 1}
                />
              </div>
              <div className="field">
                <label>Colour</label>
                <input
                  name="color"
                  type="color"
                  defaultValue={current?.color ?? "#64748b"}
                  style={{ height: 38, padding: 3 }}
                />
              </div>
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
