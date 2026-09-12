import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  EmptyState,
  ErrorNote,
  Loading,
  useDeepLinkReturn,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import { useOpsTasks, useSaveOpsTask } from "../../lib/hooks";
import { daysBetween, todayIso } from "../../lib/opsCalendar";
import { OPS_TASK_STATUSES, type OpsTask, type OpsTaskStatus } from "../../lib/types";
import TaskEditModal from "./TaskEditModal";

type StatusFilter = "all" | OpsTaskStatus;
type ScopeFilter = "all" | "linked" | "standalone";
type View = "list" | "board";

const STATUS_LABEL: Record<OpsTaskStatus, string> = {
  open: "Open",
  doing: "Doing",
  done: "Done",
};

const PRIO_DOT: Record<OpsTask["priority"], string> = {
  low: "low",
  normal: "normal",
  high: "high",
};

function nextStatus(s: OpsTaskStatus): OpsTaskStatus {
  return s === "open" ? "doing" : s === "doing" ? "done" : "open";
}

export default function TasksNotes({ focus }: { focus?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, error } = useToast();
  const tasksQ = useOpsTasks();
  const save = useSaveOpsTask();

  const [quick, setQuick] = useState("");
  const [quickKind, setQuickKind] = useState<"task" | "note">("task");
  const [view, setView] = useState<View>("list");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [scopeF, setScopeF] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<OpsTask | null>(null);
  const [creating, setCreating] = useState(false);

  const today = todayIso();
  const all = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const { arm, closeAndReturn } = useDeepLinkReturn();

  // Deep-link from a Notification: navigate here with { state: { openTaskId } }
  // to pop the existing edit modal open on a specific task. Closing it then
  // returns to Notifications instead of stranding the user here.
  useEffect(() => {
    const openId = (location.state as { openTaskId?: string } | null)
      ?.openTaskId;
    if (!openId || all.length === 0) return;
    const t = all.find((x) => x.id === openId);
    if (t) {
      setEdit(t);
      arm();
      navigate(location.pathname + location.search, {
        replace: true,
        state: {},
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, all]);

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
    if (scopeF === "linked")
      list = list.filter((t) => t.job_id || t.quote_id || t.client_id);
    if (scopeF === "standalone")
      list = list.filter((t) => !t.job_id && !t.quote_id && !t.client_id);
    if (focus === "overdue")
      list = list.filter(
        (t) => t.status !== "done" && t.due_date && t.due_date < today,
      );
    if (focus === "today")
      list = list.filter((t) => t.status !== "done" && t.due_date === today);
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.body ?? "").toLowerCase().includes(q),
      );

    const rank = (t: OpsTask) => {
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
  }, [all, statusF, scopeF, search, focus, today]);

  async function addQuick() {
    const title = quick.trim();
    if (!title) return;
    try {
      await save.mutateAsync({ values: { title, kind: quickKind } });
      setQuick("");
      toast("Added");
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not add");
    }
  }

  async function cycleStatus(t: OpsTask) {
    const status = nextStatus(t.status);
    try {
      await save.mutateAsync({
        id: t.id,
        values: {
          status,
          done_at: status === "done" ? new Date().toISOString() : null,
        },
      });
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not update");
    }
  }

  function linkChip(t: OpsTask) {
    if (t.job?.reference)
      return { label: t.job.reference, go: () => navigate("/jobs") };
    if (t.quote?.reference)
      return {
        label: t.quote.reference,
        go: () => navigate(`/quotes/${t.quote_id}`),
      };
    if (t.client?.company)
      return { label: t.client.company, go: () => navigate("/clients") };
    return null;
  }

  return (
    <>
      <div className="panel">
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
            {(["all", "linked", "standalone"] as ScopeFilter[]).map((s) => (
              <button
                key={s}
                className={`chip${scopeF === s ? " on" : ""}`}
                onClick={() => setScopeF(s)}
              >
                {s === "all" ? "Any link" : s[0].toUpperCase() + s.slice(1)}
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

        {focus && (
          <p className="hint" style={{ marginTop: 8 }}>
            Filtered to <strong>{focus}</strong> ·{" "}
            <button className="link-btn" onClick={() => navigate("/ops?tab=tasks")}>
              clear
            </button>
          </p>
        )}
      </div>

      {tasksQ.isLoading ? (
        <div className="panel">
          <Loading />
        </div>
      ) : tasksQ.isError ? (
        <div className="panel">
          <ErrorNote error={tasksQ.error} />
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState>Nothing here. Add a task or note above.</EmptyState>
        </div>
      ) : view === "list" ? (
        <div className="panel">
          <ul className="task-list">
            {rows.map((t) => {
              const overdue =
                t.status !== "done" && t.due_date && t.due_date < today;
              const chip = linkChip(t);
              return (
                <li
                  key={t.id}
                  className={`task-row${t.status === "done" ? " done" : ""}`}
                >
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
                  {t.assignee?.full_name && (
                    <span className="chip sm" title="Assignee">
                      {t.assignee.full_name}
                    </span>
                  )}
                  {chip && (
                    <button
                      className="chip sm"
                      onClick={chip.go}
                      title="Open linked record"
                    >
                      {chip.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${OPS_TASK_STATUSES.length}, minmax(260px, 1fr))`,
            gap: 14,
            overflowX: "auto",
          }}
        >
          {OPS_TASK_STATUSES.map((status) => {
            const colRows = rows.filter((t) => t.status === status);
            return (
              <div key={status} className="panel" style={{ margin: 0 }}>
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
                    const chip = linkChip(t);
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
                          {t.assignee?.full_name && (
                            <span className="chip sm">{t.assignee.full_name}</span>
                          )}
                          {chip && (
                            <button className="chip sm" onClick={chip.go}>
                              {chip.label}
                            </button>
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
        <TaskEditModal task={null} onClose={() => setCreating(false)} />
      )}
      {edit && (
        <TaskEditModal
          task={edit}
          onClose={() => closeAndReturn(() => setEdit(null))}
        />
      )}
    </>
  );
}
