import { useState } from "react";
import DateInput from "../../components/DateInput";
import TimeInput, { hhmm } from "../../components/TimeInput";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  useClients,
  useDeleteOpsTask,
  useJobs,
  useLeads,
  useOpsTasks,
  useProfiles,
  useQuotes,
  useSaveOpsTask,
  useSuppliers,
} from "../../lib/hooks";
import { formatDate } from "../../lib/format";
import { isTaskOverdue } from "../../lib/opsCalendar";
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
  due_time: string;
  job_id: string;
  quote_id: string;
  client_id: string;
  lead_id: string;
  supplier_id: string;
  assigned_to: string;
};

function seed(task: OpsTask | null, defaults?: Partial<OpsTaskPatch>): Form {
  return {
    kind: task?.kind ?? (defaults?.kind as Form["kind"]) ?? "task",
    title: task?.title ?? defaults?.title ?? "",
    body: task?.body ?? "",
    status: task?.status ?? "open",
    priority: task?.priority ?? (defaults?.priority as Form["priority"]) ?? "normal",
    due_date: task?.due_date ?? (defaults?.due_date as string) ?? "",
    due_time: hhmm(task?.due_time),
    job_id: task?.job_id ?? (defaults?.job_id as string) ?? "",
    quote_id: task?.quote_id ?? (defaults?.quote_id as string) ?? "",
    client_id: task?.client_id ?? (defaults?.client_id as string) ?? "",
    lead_id: task?.lead_id ?? (defaults?.lead_id as string) ?? "",
    supplier_id: task?.supplier_id ?? (defaults?.supplier_id as string) ?? "",
    assigned_to: task?.assigned_to ?? (defaults?.assigned_to as string) ?? "",
  };
}

/** The record a new task is being created against, most specific first. */
const LINK_KEYS = ["job_id", "quote_id", "client_id", "lead_id", "supplier_id"] as const;

export default function TaskEditModal({
  task: initialTask,
  defaults,
  onClose,
}: Props) {
  // Which task the form is editing — starts as the one passed in (null =
  // new), and switches when an existing task is picked from the panel.
  const [task, setTask] = useState<OpsTask | null>(initialTask);
  const { toast, error } = useToast();
  const save = useSaveOpsTask();
  const del = useDeleteOpsTask();
  const jobs = useJobs().data ?? [];
  const quotes = useQuotes().data ?? [];
  const clients = useClients().data ?? [];
  const leads = useLeads().data ?? [];
  const suppliers = useSuppliers().data ?? [];
  const teamMembers = (useProfiles().data ?? []).filter(
    (p) => p.role === "admin" || p.role === "user",
  );

  const [f, setF] = useState<Form>(() => seed(task, defaults));

  // Existing open / doing tasks on the same record (shipment, quote,
  // customer, lead or supplier) the form was opened from.
  const allTasks = useOpsTasks().data ?? [];
  const linkKey = LINK_KEYS.find((k) => defaults?.[k]);
  const linkId = linkKey ? (defaults?.[linkKey] as string) : null;
  const linkLabel = !linkKey
    ? ""
    : linkKey === "job_id"
      ? jobs.find((j) => j.id === linkId)?.reference ?? "this shipment"
      : linkKey === "quote_id"
        ? quotes.find((q) => q.id === linkId)?.reference ?? "this quote"
        : linkKey === "client_id"
          ? clients.find((c) => c.id === linkId)?.company ?? "this customer"
          : linkKey === "lead_id"
            ? leads.find((l) => l.id === linkId)?.company ?? "this lead"
            : suppliers.find((s) => s.id === linkId)?.company ?? "this supplier";
  const openOnRecord = linkKey
    ? allTasks
        .filter(
          (t) =>
            t.kind === "task" &&
            t.status !== "done" &&
            t[linkKey] === linkId,
        )
        .sort((a, b) =>
          (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
        )
    : [];

  function pick(t: OpsTask | null) {
    setTask(t);
    setF(seed(t, t ? undefined : defaults));
  }
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
      status: f.status,
      priority: f.priority,
      due_date: f.due_date || null,
      job_id: f.job_id || null,
      quote_id: f.quote_id || null,
      client_id: f.client_id || null,
      lead_id: f.lead_id || null,
      supplier_id: f.supplier_id || null,
      assigned_to: f.assigned_to || null,
    };
    // Only send due_time when there is one (or one is being cleared), so
    // saving still works before migration 0109 adds the column.
    if (f.due_time || task?.due_time) values.due_time = f.due_time || null;
    if (!task && defaults?.source_notification_key) {
      values.source_notification_key = defaults.source_notification_key as string;
    }
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

  /** Doing / Done footer buttons: save just the status straight away and
   *  keep the window open (it only closes on Save / Cancel / ✕). Clicking
   *  the active one sets the task back to Open. */
  async function markStatus(s: "doing" | "done") {
    if (!task) return;
    const next: OpsTask["status"] = f.status === s ? "open" : s;
    try {
      const updated = await save.mutateAsync({
        id: task.id,
        values: {
          status: next,
          done_at: next === "done" ? new Date().toISOString() : null,
        },
      });
      setTask(updated);
      set("status", next);
      toast(`Marked ${next[0].toUpperCase() + next.slice(1)}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update status");
    }
  }

  async function onDelete() {
    if (!task) return;
    if (!window.confirm("Delete this item?")) return;
    try {
      await del.mutateAsync(task.id);
      toast("Deleted");
      // Stay open (only Save / Cancel / X close the window): switch to a
      // fresh item on the same record; the open-tasks panel refreshes.
      pick(null);
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
            >
              Delete
            </button>
          )}
          {task &&
            (["doing", "done"] as const).map((s, i) => (
              <button
                key={s}
                className={`btn ${f.status === s ? `status-on is-${s}` : "outline"}`}
                onClick={() => markStatus(s)}
                disabled={save.isPending}
                title={
                  f.status === s
                    ? "Click again to set back to Open"
                    : `Mark as ${s === "doing" ? "Doing" : "Done"} (saves now, window stays open)`
                }
                style={i === 1 ? { marginRight: "auto" } : undefined}
              >
                {s === "doing" ? "Doing" : "Done"}
              </button>
            ))}
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {linkKey && (
        <div className="task-existing">
          <div className="task-existing-head">
            <strong>
              Open tasks for {linkLabel} ({openOnRecord.length})
            </strong>
            {task && (
              <button type="button" className="link-btn" onClick={() => pick(null)}>
                + New task instead
              </button>
            )}
          </div>
          {openOnRecord.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              No open tasks yet — add one below.
            </p>
          ) : (
            <ul>
              {openOnRecord.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`task-existing-row${task?.id === t.id ? " on" : ""}`}
                    onClick={() => pick(t)}
                    title="Open this task"
                  >
                    <span className={`task-existing-status is-${t.status}`}>
                      {t.status === "doing" ? "Doing" : "Open"}
                    </span>
                    <span className="task-existing-title">{t.title}</span>
                    {t.due_date && (
                      <span
                        className={`task-existing-due${isTaskOverdue(t) ? " over" : ""}`}
                      >
                        {formatDate(t.due_date)}
                        {t.due_time ? ` ${hhmm(t.due_time)}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {/* Title shares its row with Status (a note has no status, so its
          title takes the full row). */}
      <div className="grid2">
        <div
          className="field"
          style={f.kind === "task" ? undefined : { gridColumn: "1 / -1" }}
        >
          <label>Title</label>
          <input
            autoFocus
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What needs doing?"
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
          <label>Due date</label>
          <DateInput
            value={f.due_date}
            onChange={(v) => set("due_date", v)}
          />
        </div>
        <div className="field">
          <label>Due time</label>
          <TimeInput value={f.due_time} onChange={(v) => set("due_time", v)} />
        </div>
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

      <div className="grid2">
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
          <label>Link to lead</label>
          <select
            value={f.lead_id}
            onChange={(e) => set("lead_id", e.target.value)}
          >
            <option value="">—</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.company}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid2">
        <div className="field">
          <label>Link to supplier</label>
          <select
            value={f.supplier_id}
            onChange={(e) => set("supplier_id", e.target.value)}
          >
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Assignee</label>
          <select
            value={f.assigned_to}
            onChange={(e) => set("assigned_to", e.target.value)}
          >
            <option value="">Unassigned</option>
            {teamMembers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || "—"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(task?.source_notification_key || defaults?.source_notification_key) && (
        <p className="hint" style={{ marginTop: -4 }}>
          Created from a notification.
        </p>
      )}

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
