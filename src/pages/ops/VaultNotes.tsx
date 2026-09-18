import { useMemo, useState } from "react";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  useRowSelection,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteVaultNotesBulk,
  useSaveVaultNote,
  useUpdateVaultNotesBulk,
  useVaultNotes,
} from "../../lib/hooks";
import { daysBetween, todayIso } from "../../lib/opsCalendar";
import {
  OPS_TASK_PRIORITIES,
  OPS_TASK_STATUSES,
  type OpsTaskStatus,
  type VaultBudgetScope,
  type VaultNote,
} from "../../lib/types";
import VaultNoteEditModal from "./VaultNoteEditModal";

type StatusFilter = "all" | OpsTaskStatus;
type View = "list" | "board";

const STATUS_LABEL: Record<OpsTaskStatus, string> = {
  open: "Open",
  doing: "Doing",
  done: "Done",
};

const PRIO_DOT: Record<VaultNote["priority"], string> = {
  low: "low",
  normal: "normal",
  high: "high",
};

function nextStatus(s: OpsTaskStatus): OpsTaskStatus {
  return s === "open" ? "doing" : s === "doing" ? "done" : "open";
}

export default function VaultNotes({ scope }: { scope: VaultBudgetScope }) {
  const { toast, error } = useToast();
  const notesQ = useVaultNotes();
  const save = useSaveVaultNote();
  const bulkUpdate = useUpdateVaultNotesBulk();
  const bulkDelete = useDeleteVaultNotesBulk();

  const [quick, setQuick] = useState("");
  const [quickKind, setQuickKind] = useState<"task" | "note">("task");
  const [view, setView] = useState<View>("board");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<VaultNote | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const today = todayIso();
  const all = useMemo(
    () => (notesQ.data ?? []).filter((n) => (n.scope ?? "personal") === scope),
    [notesQ.data, scope],
  );

  const counts = useMemo(() => {
    const open = all.filter((t) => t.kind === "task" && t.status !== "done");
    return {
      open: open.length,
      dueToday: open.filter((t) => t.due_date === today).length,
      overdue: open.filter((t) => t.due_date && t.due_date < today).length,
    };
  }, [all, today]);

  const rows = useMemo(() => {
    let list = all;
    if (statusF !== "all") list = list.filter((t) => t.status === statusF);
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.body ?? "").toLowerCase().includes(q),
      );

    const rank = (t: VaultNote) => {
      if (t.status === "done") return 5;
      if (t.due_date && t.due_date < today) return 0; // overdue
      if (t.due_date === today) return 1;
      if (t.due_date) return 2;
      return 3;
    };
    return [...list].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [all, statusF, search, today]);

  const sel = useRowSelection(all, rows);

  async function addQuick() {
    const title = quick.trim();
    if (!title) return;
    try {
      await save.mutateAsync({ values: { title, kind: quickKind, scope } });
      setQuick("");
      toast("Added");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add");
    }
  }

  async function cycleStatus(t: VaultNote) {
    const status = nextStatus(t.status);
    try {
      await save.mutateAsync({ id: t.id, values: { status } });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function bulkDeleteSelected() {
    const n = sel.count;
    if (n === 0) return;
    if (!window.confirm(`Delete ${n} item${n === 1 ? "" : "s"}? This cannot be undone.`))
      return;
    try {
      await bulkDelete.mutateAsync(sel.ids);
      toast(`Deleted ${n} item${n === 1 ? "" : "s"}`);
      sel.clear();
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>
        Notes <span className="chip sm on">{scope === "personal" ? "Personal" : "Business"}</span>
      </h3>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Private to you — never shared or linked elsewhere in the system.
      </p>

      <div className="ct-quickadd">
        <select
          value={quickKind}
          onChange={(e) => setQuickKind(e.target.value as "task" | "note")}
        >
          <option value="task">Task</option>
          <option value="note">Note</option>
        </select>
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addQuick()}
          placeholder={`Add a ${quickKind}… (Enter)`}
        />
        <button className="btn" onClick={addQuick} disabled={save.isPending}>
          Add
        </button>
        <button className="btn outline" onClick={() => setCreating(true)}>
          Detailed…
        </button>
        {view === "list" && (
          <>
            <button
              className="btn outline"
              onClick={() => setBulkOpen(true)}
              disabled={sel.count === 0}
              title={
                sel.count === 0 ? "Tick rows in the list to bulk edit" : undefined
              }
            >
              Bulk Edit{sel.count ? ` (${sel.count})` : ""}
            </button>
            <button
              className="btn danger"
              onClick={bulkDeleteSelected}
              disabled={sel.count === 0 || bulkDelete.isPending}
              title={
                sel.count === 0 ? "Tick rows in the list to delete" : undefined
              }
            >
              Delete{sel.count ? ` (${sel.count})` : ""}
            </button>
          </>
        )}
      </div>

      <div className="ct-taskbar">
        <div className="mini-stats">
          <div>
            <div className="k">Open</div>
            <div className="v">{counts.open}</div>
          </div>
          <div>
            <div className="k">Due today</div>
            <div className="v">{counts.dueToday}</div>
          </div>
          <div>
            <div className="k">Overdue</div>
            <div className="v" style={{ color: counts.overdue ? "#b3261e" : undefined }}>
              {counts.overdue}
            </div>
          </div>
        </div>
        <div className="chips">
          {(["list", "board"] as View[]).map((v) => (
            <button
              key={v}
              className={`chip${view === v ? " on" : ""}`}
              onClick={() => {
                setView(v);
                if (v === "board") setStatusF("all");
              }}
            >
              {v === "list" ? "List" : "Board"}
            </button>
          ))}
          {view === "list" &&
            (["all", "open", "doing", "done"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={`chip${statusF === s ? " on" : ""}`}
                onClick={() => setStatusF(s)}
              >
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          <input
            className="ct-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
          />
        </div>
      </div>

      {notesQ.isLoading ? (
        <Loading />
      ) : notesQ.isError ? (
        <ErrorNote error={notesQ.error} />
      ) : rows.length === 0 ? (
        <EmptyState>Nothing here. Add a task or note above.</EmptyState>
      ) : view === "list" ? (
        <>
          <div className="task-list-head">
            <label className="check">
              <input
                type="checkbox"
                checked={sel.allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = sel.someChecked && !sel.allChecked;
                }}
                onChange={sel.toggleAll}
              />
              Select all
            </label>
          </div>
          <ul className="task-list">
            {rows.map((t) => {
              const overdue =
                t.status !== "done" && t.due_date && t.due_date < today;
              return (
                <li
                  key={t.id}
                  className={`task-row${t.status === "done" ? " done" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="task-select"
                    checked={sel.isSelected(t.id)}
                    onChange={() => sel.toggle(t.id)}
                    title="Select"
                  />
                  {t.kind === "task" ? (
                    <button
                      className={`task-check is-${t.status}`}
                      onClick={() => cycleStatus(t)}
                      title={`Status: ${t.status} — click to advance`}
                      aria-label="Advance status"
                    />
                  ) : (
                    <span className="task-check is-note" title="Note" />
                  )}
                  <span className={`prio-dot ${PRIO_DOT[t.priority]}`} />
                  <button className="task-title" onClick={() => setEdit(t)}>
                    {t.title}
                    {t.body && <span className="task-body"> — {t.body}</span>}
                  </button>
                  {t.due_date && (
                    <span className={`due-badge${overdue ? " over" : ""}`}>
                      {overdue
                        ? `${Math.abs(daysBetween(today, t.due_date))}d late`
                        : t.due_date === today
                          ? "today"
                          : t.due_date}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${OPS_TASK_STATUSES.length}, minmax(200px, 1fr))`,
            gap: 14,
            overflowX: "auto",
          }}
        >
          {OPS_TASK_STATUSES.map((status) => {
            const colRows = rows.filter((t) => t.status === status);
            return (
              <div key={status} style={{ margin: 0 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <strong style={{ fontSize: "0.85rem" }}>
                    {STATUS_LABEL[status]}
                  </strong>
                  <span className="muted small">{colRows.length}</span>
                </div>
                <div className="stack-sm">
                  {colRows.map((t) => {
                    const overdue =
                      t.status !== "done" && t.due_date && t.due_date < today;
                    return (
                      <div key={t.id} className="task-card">
                        <div className="task-card-top">
                          <span className={`prio-dot ${PRIO_DOT[t.priority]}`} />
                          <button
                            className="task-title"
                            onClick={() => setEdit(t)}
                          >
                            {t.title}
                          </button>
                        </div>
                        {t.body && <p className="task-body">{t.body}</p>}
                        <div className="task-card-foot">
                          {t.due_date && (
                            <span className={`due-badge${overdue ? " over" : ""}`}>
                              {overdue
                                ? `${Math.abs(daysBetween(today, t.due_date))}d late`
                                : t.due_date === today
                                  ? "today"
                                  : t.due_date}
                            </span>
                          )}
                          {t.kind === "task" && (
                            <button
                              className="btn ghost btn-sm"
                              onClick={() => cycleStatus(t)}
                              title="Advance status"
                            >
                              Advance →
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <VaultNoteEditModal note={null} scope={scope} onClose={() => setCreating(false)} />
      )}
      {edit && (
        <VaultNoteEditModal note={edit} scope={scope} onClose={() => setEdit(null)} />
      )}

      {bulkOpen && (
        <BulkEditModal
          title={`Bulk edit ${sel.count} item${sel.count === 1 ? "" : "s"}`}
          count={sel.count}
          noun="item"
          busy={bulkUpdate.isPending}
          fields={[
            {
              key: "status",
              label: "Status",
              type: "select",
              allowClear: false,
              options: OPS_TASK_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABEL[s],
              })),
            },
            {
              key: "priority",
              label: "Priority",
              type: "select",
              allowClear: false,
              options: OPS_TASK_PRIORITIES.map((p) => ({
                value: p,
                label: p[0].toUpperCase() + p.slice(1),
              })),
            },
            {
              key: "due_date",
              label: "Due date",
              type: "text",
              placeholder: "YYYY-MM-DD",
            },
          ]}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as Partial<
                  Pick<VaultNote, "status" | "priority" | "due_date">
                >,
              });
              toast(`Updated ${n} item${n === 1 ? "" : "s"}`);
              sel.clear();
              setBulkOpen(false);
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not update");
            }
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}
