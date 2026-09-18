import { useState } from "react";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useDeleteVaultNote, useSaveVaultNote } from "../../lib/hooks";
import {
  OPS_TASK_PRIORITIES,
  OPS_TASK_STATUSES,
  type VaultBudgetScope,
  type VaultNote,
  type VaultNoteDraft,
} from "../../lib/types";

interface Props {
  /** null = create a new note. */
  note: VaultNote | null;
  /** Which Personal/Business side a new note is created into — ignored
   *  when editing an existing note (its scope doesn't change). */
  scope: VaultBudgetScope;
  /** Prefill for a new note (e.g. due_date from the calendar). */
  defaults?: Partial<VaultNoteDraft>;
  onClose: () => void;
}

function seed(note: VaultNote | null, defaults?: Partial<VaultNoteDraft>): VaultNoteDraft {
  return {
    kind: note?.kind ?? defaults?.kind ?? "task",
    title: note?.title ?? defaults?.title ?? "",
    body: note?.body ?? defaults?.body ?? "",
    status: note?.status ?? defaults?.status ?? "open",
    priority: note?.priority ?? defaults?.priority ?? "normal",
    due_date: note?.due_date ?? defaults?.due_date ?? "",
  };
}

export default function VaultNoteEditModal({ note, scope, defaults, onClose }: Props) {
  const { toast, error } = useToast();
  const save = useSaveVaultNote();
  const del = useDeleteVaultNote();

  const [f, setF] = useState<VaultNoteDraft>(() => seed(note, defaults));
  function set<K extends keyof VaultNoteDraft>(k: K, v: VaultNoteDraft[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function onSave() {
    if (!f.title.trim()) {
      error("A title is required");
      return;
    }
    const values: Partial<VaultNoteDraft> & {
      title: string;
      scope?: VaultBudgetScope;
    } = {
      kind: f.kind,
      title: f.title.trim(),
      body: f.body.trim() || "",
      status: f.kind === "note" ? "open" : f.status,
      priority: f.priority,
      due_date: f.due_date || "",
    };
    if (!note) values.scope = scope;
    try {
      await save.mutateAsync(note ? { id: note.id, values } : { values });
      toast(note ? "Updated" : "Added");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function onDelete() {
    if (!note) return;
    if (!window.confirm("Delete this item?")) return;
    try {
      await del.mutateAsync(note.id);
      toast("Deleted");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <Modal
      title={note ? "Edit item" : "New item"}
      onClose={onClose}
      footer={
        <>
          {note && (
            <button
              className="btn danger"
              onClick={onDelete}
              disabled={del.isPending}
              style={{ marginRight: "auto" }}
            >
              Delete
            </button>
          )}
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid2">
        <div className="field">
          <label>Type</label>
          <select
            value={f.kind}
            onChange={(e) => set("kind", e.target.value as VaultNoteDraft["kind"])}
          >
            <option value="task">Task</option>
            <option value="note">Note</option>
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select
            value={f.priority}
            onChange={(e) =>
              set("priority", e.target.value as VaultNoteDraft["priority"])
            }
          >
            {OPS_TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p[0].toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Title</label>
        <input
          autoFocus
          value={f.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="What needs doing?"
        />
      </div>

      <div className="grid2">
        <div className="field">
          <label>Due date</label>
          <input
            type="date"
            value={f.due_date}
            onChange={(e) => set("due_date", e.target.value)}
          />
        </div>
        {f.kind === "task" && (
          <div className="field">
            <label>Status</label>
            <select
              value={f.status}
              onChange={(e) =>
                set("status", e.target.value as VaultNoteDraft["status"])
              }
            >
              {OPS_TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="field">
        <label>Notes</label>
        <textarea
          value={f.body}
          onChange={(e) => set("body", e.target.value)}
          placeholder="Detail, context, links…"
        />
      </div>
    </Modal>
  );
}
