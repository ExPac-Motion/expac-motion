import { useState } from "react";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  useClients,
  useDeleteOpsTask,
  useJobs,
  useQuotes,
  useSaveOpsTask,
} from "../../lib/hooks";
import {
  OPS_TASK_PRIORITIES,
  OPS_TASK_STATUSES,
  type OpsTask,
  type OpsTaskPatch,
} from "../../lib/types";

interface Props {
  /** null = create a new task. */
  task: OpsTask | null;
  /** Prefill for a new task (e.g. due_date from the calendar, job_id from a job). */
  defaults?: Partial<OpsTaskPatch>;
  onClose: () => void;
}

type Form = {
  kind: "task" | "note";
  title: string;
  body: string;
  status: OpsTask["status"];
  priority: OpsTask["priority"];
  due_date: string;
  job_id: string;
  quote_id: string;
  client_id: string;
};

function seed(task: OpsTask | null, defaults?: Partial<OpsTaskPatch>): Form {
  return {
    kind: task?.kind ?? (defaults?.kind as Form["kind"]) ?? "task",
    title: task?.title ?? "",
    body: task?.body ?? "",
    status: task?.status ?? "open",
    priority: task?.priority ?? (defaults?.priority as Form["priority"]) ?? "normal",
    due_date: task?.due_date ?? (defaults?.due_date as string) ?? "",
    job_id: task?.job_id ?? (defaults?.job_id as string) ?? "",
    quote_id: task?.quote_id ?? (defaults?.quote_id as string) ?? "",
    client_id: task?.client_id ?? (defaults?.client_id as string) ?? "",
  };
}

export default function TaskEditModal({ task, defaults, onClose }: Props) {
  const { toast, error } = useToast();
  const save = useSaveOpsTask();
  const del = useDeleteOpsTask();
  const jobs = useJobs().data ?? [];
  const quotes = useQuotes().data ?? [];
  const clients = useClients().data ?? [];

  const [f, setF] = useState<Form>(() => seed(task, defaults));
  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  async function onSave() {
    if (!f.title.trim()) {
      error("A title is required");
      return;
    }
    const values: OpsTaskPatch & { title: string } = {
      kind: f.kind,
      title: f.title.trim(),
      body: f.body.trim() || null,
      status: f.kind === "note" ? "open" : f.status,
      priority: f.priority,
      due_date: f.due_date || null,
      job_id: f.job_id || null,
      quote_id: f.quote_id || null,
      client_id: f.client_id || null,
    };
    if (task && f.status === "done" && task.status !== "done") {
      values.done_at = new Date().toISOString();
    }
    try {
      await save.mutateAsync(task ? { id: task.id, values } : { values });
      toast(task ? "Updated" : "Added");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function onDelete() {
    if (!task) return;
    if (!window.confirm("Delete this item?")) return;
    try {
      await del.mutateAsync(task.id);
      toast("Deleted");
      onClose();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <Modal
      title={task ? "Edit item" : "New item"}
      onClose={onClose}
      footer={
        <>
          {task && (
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
            onChange={(e) => set("kind", e.target.value as Form["kind"])}
          >
            <option value="task">Task</option>
            <option value="note">Note</option>
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select
            value={f.priority}
            onChange={(e) => set("priority", e.target.value as Form["priority"])}
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
              onChange={(e) => set("status", e.target.value as Form["status"])}
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

      <div className="grid2">
        <div className="field">
          <label>Link to shipment</label>
          <select value={f.job_id} onChange={(e) => set("job_id", e.target.value)}>
            <option value="">—</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.reference}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Link to quote</label>
          <select
            value={f.quote_id}
            onChange={(e) => set("quote_id", e.target.value)}
          >
            <option value="">—</option>
            {quotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.reference}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label>Link to customer</label>
        <select
          value={f.client_id}
          onChange={(e) => set("client_id", e.target.value)}
        >
          <option value="">—</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company}
            </option>
          ))}
        </select>
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
