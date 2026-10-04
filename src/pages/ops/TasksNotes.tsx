import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import DataTable, { type DataColumn } from "../../components/DataTable";
import {
  BulkEditModal,
  EmptyState,
  ErrorNote,
  Loading,
  PageTools,
  RowActions,
  RowActionsHead,
  SearchInput,
  useDeepLinkReturn,
  useRowSelection,
} from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useDeleteOpsTasksBulk,
  useOpsTasks,
  useProfiles,
  useSaveOpsTask,
  useUpdateOpsTasksBulk,
} from "../../lib/hooks";
import {
  daysBetween,
  isTaskOverdue,
  nowHHMM,
  todayIso,
} from "../../lib/opsCalendar";
import {
  OPS_TASK_PRIORITIES,
  OPS_TASK_STATUSES,
  type OpsTask,
  type OpsTaskPatch,
  type OpsTaskStatus,
} from "../../lib/types";
import TaskEditModal from "./TaskEditModal";
import { hhmm } from "../../components/TimeInput";
import { formatDate } from "../../lib/format";

/** Overdue badge text: "3d late", or "late 14:00" when it's today's due
 *  time that has passed. */
function lateLabel(t: OpsTask, today: string): string {
  const days = Math.abs(daysBetween(today, (t.due_date ?? today).slice(0, 10)));
  return days > 0 ? `${days}d late` : `late ${hhmm(t.due_time)}`;
}

/** Due badge text (not overdue): "today" / dd/mm/yyyy, plus the due time. */
function dueLabel(t: OpsTask, today: string): string {
  const day = t.due_date === today ? "today" : formatDate(t.due_date);
  const time = hhmm(t.due_time);
  return time ? `${day} ${time}` : day;
}

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
  const bulkUpdate = useUpdateOpsTasksBulk();
  const bulkDelete = useDeleteOpsTasksBulk();
  const teamMembers = (useProfiles().data ?? []).filter(
    (p) => p.role === "admin" || p.role === "user",
  );

  const [quick, setQuick] = useState("");
  const [quickKind, setQuickKind] = useState<"task" | "note">("task");
  const [view, setView] = useState<View>("board");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [scopeF, setScopeF] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<OpsTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Re-evaluated every minute so a task turns overdue the moment its due
  // time passes, without a reload.
  const [clock, setClock] = useState(() => ({ today: todayIso(), now: nowHHMM() }));
  useEffect(() => {
    const id = window.setInterval(
      () => setClock({ today: todayIso(), now: nowHHMM() }),
      60_000,
    );
    return () => window.clearInterval(id);
  }, []);
  const today = clock.today;
  const over = (t: OpsTask) => isTaskOverdue(t, clock.today, clock.now);
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
      dueToday: open.filter((t) => t.due_date === today && !over(t)).length,
      overdue: open.filter(over).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, clock]);

  const rows = useMemo(() => {
    let list = all;
    if (statusF !== "all") list = list.filter((t) => t.status === statusF);
    if (scopeF === "linked")
      list = list.filter((t) => t.job_id || t.quote_id || t.client_id);
    if (scopeF === "standalone")
      list = list.filter((t) => !t.job_id && !t.quote_id && !t.client_id);
    if (focus === "overdue")
      list = list.filter(over);
    if (focus === "today")
      list = list.filter(
        (t) => t.status !== "done" && t.due_date === today && !over(t),
      );
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.body ?? "").toLowerCase().includes(q),
      );

    const rank = (t: OpsTask) => {
      if (t.status === "done") return 5;
      if (over(t)) return 0; // overdue
      if (t.due_date === today) return 1;
      if (t.due_date) return 2;
      return 3;
    };
    return [...list].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      if (a.due_date && b.due_date)
        return (a.due_date + (a.due_time ?? "99")).localeCompare(
          b.due_date + (b.due_time ?? "99"),
        );
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [all, statusF, scopeF, search, focus, today]);

  const sel = useRowSelection(all, rows);
  const [toolsSlot, setToolsSlot] = useState<HTMLDivElement | null>(null);

  const taskCols: DataColumn<OpsTask>[] = [
    {
      key: "actions",
      fixed: true,
      width: 110,
      header: (
        <RowActionsHead
          checked={sel.allChecked}
          indeterminate={sel.someChecked}
          onToggle={sel.toggleAll}
        />
      ),
      render: (t) => (
        <RowActions
          selected={sel.isSelected(t.id)}
          onSelectToggle={() => sel.toggle(t.id)}
          onEdit={() => setEdit(t)}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      sortValue: (t) => t.status,
      render: (t) =>
        t.kind === "task" ? (
          <span className="task-status-cell">
            <button
              className={`task-check is-${t.status}`}
              onClick={() => cycleStatus(t)}
              title={`Status: ${t.status} — click to advance`}
              aria-label="Advance status"
            />
            {STATUS_LABEL[t.status]}
          </span>
        ) : (
          <span className="task-status-cell">
            <span className="task-check is-note" title="Note" />
            {t.status === "open" ? "Note" : STATUS_LABEL[t.status]}
          </span>
        ),
    },
    {
      key: "title",
      header: "Title",
      width: 360,
      sortValue: (t) => t.title,
      render: (t) => (
        <button className="task-title" onClick={() => setEdit(t)}>
          <span className={`prio-dot ${PRIO_DOT[t.priority]}`} /> {t.title}
          {t.body && <span className="task-body"> — {t.body}</span>}
        </button>
      ),
    },
    {
      key: "due",
      header: "Due",
      width: 140,
      sortValue: (t) => (t.due_date ? t.due_date + (t.due_time ?? "99") : ""),
      render: (t) =>
        t.due_date ? (
          <span className={`due-badge${over(t) ? " over" : ""}`}>
            {over(t) ? lateLabel(t, today) : dueLabel(t, today)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "priority",
      header: "Priority",
      width: 100,
      sortValue: (t) => t.priority,
      render: (t) => t.priority[0].toUpperCase() + t.priority.slice(1),
    },
    {
      key: "assignee",
      header: "Assignee",
      width: 150,
      sortValue: (t) => t.assignee?.full_name ?? "",
      render: (t) => t.assignee?.full_name || "—",
    },
    {
      key: "linked",
      header: "Linked to",
      width: 170,
      sortValue: (t) => linkChip(t)?.label ?? "",
      render: (t) => {
        const chip = linkChip(t);
        return chip ? (
          <button className="chip sm" onClick={chip.go} title="Open linked record">
            {chip.label}
          </button>
        ) : (
          "—"
        );
      },
    },
    {
      key: "kind",
      header: "Type",
      width: 80,
      defaultHidden: true,
      sortValue: (t) => t.kind,
      render: (t) => (t.kind === "task" ? "Task" : "Note"),
    },
  ];

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

  function linkChip(t: OpsTask) {
    if (t.job?.reference)
      return {
        label: t.job.reference,
        go: () => navigate("/jobs", { state: { openJobId: t.job_id } }),
      };
    if (t.quote?.reference)
      return {
        label: t.quote.reference,
        go: () => navigate(`/quotes/${t.quote_id}`),
      };
    if (t.client?.company)
      return {
        label: t.client.company,
        go: () =>
          navigate("/clients", { state: { openContactId: t.client_id } }),
      };
    if (t.lead?.company)
      return {
        label: t.lead.company,
        go: () =>
          navigate("/crm?tab=leads", { state: { openLeadId: t.lead_id } }),
      };
    if (t.supplier?.company)
      return {
        label: t.supplier.company,
        go: () =>
          navigate("/suppliers", { state: { openContactId: t.supplier_id } }),
      };
    if (t.agent?.company)
      return {
        label: t.agent.company,
        go: () => navigate("/agents", { state: { openContactId: t.agent_id } }),
      };
    if (t.transporter?.company)
      return {
        label: t.transporter.company,
        go: () =>
          navigate("/transporters", { state: { openContactId: t.transporter_id } }),
      };
    if (t.clearing_agent?.company)
      return {
        label: t.clearing_agent.company,
        go: () =>
          navigate("/clearing-agents", {
            state: { openContactId: t.clearing_agent_id },
          }),
      };
    return null;
  }

  return (
    <>
      <PageTools
        onToolsSlot={setToolsSlot}
        search={
          <SearchInput value={search} onChange={setSearch} placeholder="Search tasks & notes…" />
        }
        filters={
          <>
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
            </div>
            <div className="chips">
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
            </div>
            <div className="chips">
              {(["all", "linked", "standalone"] as ScopeFilter[]).map((s) => (
                <button
                  key={s}
                  className={`chip${scopeF === s ? " on" : ""}`}
                  onClick={() => setScopeF(s)}
                >
                  {s === "all" ? "Any link" : s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            {focus && (
              <span className="topbar-filter">
                Filtered to <strong>{focus}</strong> ·{" "}
                <button className="link-btn" onClick={() => navigate("/ops?tab=tasks")}>
                  clear
                </button>
              </span>
            )}
          </>
        }
        count={
          <>
            {counts.open} open · {counts.dueToday} due today ·{" "}
            <span style={{ color: counts.overdue ? "var(--orange-ink)" : undefined }}>
              {counts.overdue} overdue
            </span>
          </>
        }
        primary={
          <button className="btn" onClick={() => setCreating(true)}>
            + New Task / Note
          </button>
        }
      >
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
            placeholder={`Quick add a ${quickKind}… (Enter)`}
          />
          <button className="btn outline" onClick={addQuick} disabled={save.isPending}>
            Add
          </button>
        </div>
        {view === "list" && (
          <>
            <button
              className="btn outline bulk"
              onClick={() => setBulkOpen(true)}
              disabled={sel.count === 0}
              title={
                sel.count === 0
                  ? "Tick rows in the list to bulk edit"
                  : undefined
              }
            >
              Bulk Edit{sel.count ? ` (${sel.count})` : ""}
            </button>
            <button
              className="btn danger"
              onClick={bulkDeleteSelected}
              disabled={sel.count === 0 || bulkDelete.isPending}
              title={
                sel.count === 0
                  ? "Tick rows in the list to delete"
                  : undefined
              }
            >
              Delete{sel.count ? ` (${sel.count})` : ""}
            </button>
          </>
        )}
      </PageTools>

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
          <DataTable
            tableKey="ops-tasks"
            className="table--compact"
            toolsPortal={toolsSlot}
            columns={taskCols}
            rows={rows}
            rowKey={(t) => t.id}
            rowClass={(t) => (t.status === "done" ? "is-done" : undefined)}
          />
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
                    const overdue = over(t);
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
                                ? lateLabel(t, today)
                                : dueLabel(t, today)}
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
              type: "date",
            },
            {
              key: "due_time",
              label: "Due time",
              type: "time",
            },
            {
              key: "assigned_to",
              label: "Assignee",
              type: "select",
              options: teamMembers.map((p) => ({
                value: p.id,
                label: p.full_name || "—",
              })),
            },
          ]}
          onApply={async (patch) => {
            const n = sel.count;
            try {
              await bulkUpdate.mutateAsync({
                ids: sel.ids,
                patch: patch as unknown as OpsTaskPatch,
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
    </>
  );
}
