import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useFollowUpLog,
  useJobs,
  useLeads,
  useMailCampaigns,
  useMessagesForJobs,
  useNotificationState,
  useOpportunities,
  useOpsTasks,
  useQuotes,
  useSaveOpsTask,
  useSetNotificationState,
  useShipmentDocumentsForJobs,
} from "../../lib/hooks";
import {
  buildNotifications,
  type NotificationDomain,
  type NotificationItem,
} from "../../lib/notifications";
import { timeAgo } from "../../lib/format";
import TaskEditModal from "./TaskEditModal";
import type { OpsTaskPatch } from "../../lib/types";

const DOMAIN_ICON: Record<NotificationDomain, ReactNode> = {
  sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 4 4 5-6" />
    </svg>
  ),
  shipments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7h13v10H3zM16 10h4l1 3v4h-5" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  ),
  operations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  ),
};

type Filter = "all" | "unread";

export default function NotificationsTab() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const saveTask = useSaveOpsTask();
  const leadsQ = useLeads();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const oppsQ = useOpportunities();
  const tasksQ = useOpsTasks();
  const campaignsQ = useMailCampaigns();
  const followUpQ = useFollowUpLog();
  const stateQ = useNotificationState();
  const setState = useSetNotificationState();

  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const jobIds = useMemo(() => jobs.map((j) => j.id), [jobs]);
  const messagesQ = useMessagesForJobs(jobIds);
  const documentsQ = useShipmentDocumentsForJobs(jobIds);

  const [filter, setFilter] = useState<Filter>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [taskDefaults, setTaskDefaults] = useState<Partial<OpsTaskPatch> | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Snapshot "now" once per mount — keeps the feed calc pure across re-renders.
  const [now] = useState(() => Date.now());

  const isLoading =
    leadsQ.isLoading ||
    quotesQ.isLoading ||
    jobsQ.isLoading ||
    oppsQ.isLoading ||
    tasksQ.isLoading ||
    campaignsQ.isLoading ||
    followUpQ.isLoading ||
    stateQ.isLoading;

  const stateByKey = useMemo(() => {
    const m = new Map<string, { read_at: string | null; archived_at: string | null }>();
    for (const s of stateQ.data ?? []) m.set(s.notification_key, s);
    return m;
  }, [stateQ.data]);

  const items = useMemo(() => {
    return buildNotifications(now, {
      leads: leadsQ.data ?? [],
      quotes: quotesQ.data ?? [],
      jobs,
      opportunities: oppsQ.data ?? [],
      tasks: tasksQ.data ?? [],
      campaigns: campaignsQ.data ?? [],
      followUps: followUpQ.data ?? [],
      messages: messagesQ.data ?? [],
      documents: documentsQ.data ?? [],
    });
  }, [
    now,
    leadsQ.data,
    quotesQ.data,
    jobs,
    oppsQ.data,
    tasksQ.data,
    campaignsQ.data,
    followUpQ.data,
    messagesQ.data,
    documentsQ.data,
  ]);

  const visible = items.filter((n) => {
    const s = stateByKey.get(n.key);
    if (!showArchived && s?.archived_at) return false;
    if (filter === "unread" && s?.read_at) return false;
    return true;
  });

  function markRead(n: NotificationItem, read: boolean) {
    setState.mutate({ key: n.key, patch: { read_at: read ? new Date().toISOString() : null } });
  }
  function archive(n: NotificationItem) {
    setState.mutate({ key: n.key, patch: { archived_at: new Date().toISOString() } });
  }
  function unarchive(n: NotificationItem) {
    setState.mutate({ key: n.key, patch: { archived_at: null } });
  }
  function createTask(n: NotificationItem) {
    setTaskDefaults({
      title: n.text,
      job_id: n.jobId ?? null,
      quote_id: n.quoteId ?? null,
      client_id: n.clientId ?? null,
      source_notification_key: n.key,
    });
    markRead(n, true);
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === visible.length && visible.length > 0
        ? new Set()
        : new Set(visible.map((n) => n.key)),
    );
  }
  function bulkMarkRead(read: boolean) {
    const ts = read ? new Date().toISOString() : null;
    for (const key of selected) setState.mutate({ key, patch: { read_at: ts } });
    setSelected(new Set());
  }
  function bulkArchive() {
    const ts = new Date().toISOString();
    for (const key of selected) setState.mutate({ key, patch: { archived_at: ts } });
    setSelected(new Set());
  }
  async function bulkCreateTasks() {
    const chosen = items.filter((n) => selected.has(n.key));
    for (const n of chosen) {
      await saveTask.mutateAsync({
        values: {
          title: n.text,
          job_id: n.jobId ?? null,
          quote_id: n.quoteId ?? null,
          client_id: n.clientId ?? null,
          source_notification_key: n.key,
        },
      });
      setState.mutate({ key: n.key, patch: { read_at: new Date().toISOString() } });
    }
    toast(`Created ${chosen.length} task${chosen.length === 1 ? "" : "s"}`);
    setSelected(new Set());
  }
  function open(n: NotificationItem) {
    markRead(n, true);
    navigate(n.to, n.navState ? { state: n.navState } : undefined);
  }

  if (isLoading) return <Loading />;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Notifications</h2>
          <p>Everything across quotations, shipments, customers and mail.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn btn-sm${filter === "all" ? "" : " outline"}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={`btn btn-sm${filter === "unread" ? "" : " outline"}`}
            onClick={() => setFilter("unread")}
          >
            Unread
          </button>
          <button
            className={`btn btn-sm${showArchived ? "" : " outline"}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <>
          <div className="notif-tab-bulkbar">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === visible.length}
              ref={(el) => {
                if (el) {
                  el.indeterminate =
                    selected.size > 0 && selected.size < visible.length;
                }
              }}
              onChange={toggleSelectAll}
              aria-label="Select all"
            />
            {selected.size > 0 ? (
              <>
                <span className="muted small">{selected.size} selected</span>
                <button className="btn ghost btn-sm" onClick={() => bulkMarkRead(true)}>
                  Mark read
                </button>
                <button className="btn ghost btn-sm" onClick={() => bulkMarkRead(false)}>
                  Mark unread
                </button>
                <button className="btn ghost btn-sm" onClick={bulkCreateTasks}>
                  Create tasks
                </button>
                <button className="btn ghost btn-sm" onClick={bulkArchive}>
                  Archive
                </button>
              </>
            ) : (
              <span className="muted small">Select all</span>
            )}
          </div>
          <div className="notif-tab-list">
          {visible.map((n) => {
            const s = stateByKey.get(n.key);
            const unread = !s?.read_at;
            const archived = !!s?.archived_at;
            return (
              <div key={n.key} className={`notif-tab-row${unread ? " unread" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected.has(n.key)}
                  onChange={() => toggleSelect(n.key)}
                  aria-label="Select notification"
                />
                <span className={`notif-ico ${n.domain}`}>{DOMAIN_ICON[n.domain]}</span>
                <button className="notif-tab-text" onClick={() => open(n)}>
                  {n.text}
                </button>
                <span className="notif-tab-when">{timeAgo(n.when)}</span>
                <div className="notif-tab-actions">
                  <button
                    className="btn ghost btn-sm"
                    onClick={() => markRead(n, unread ? true : false)}
                  >
                    {unread ? "Mark read" : "Mark unread"}
                  </button>
                  <button className="btn ghost btn-sm" onClick={() => createTask(n)}>
                    Create task
                  </button>
                  {archived ? (
                    <button className="btn ghost btn-sm" onClick={() => unarchive(n)}>
                      Unarchive
                    </button>
                  ) : (
                    <button className="btn ghost btn-sm" onClick={() => archive(n)}>
                      Archive
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </>
      )}

      {taskDefaults && (
        <TaskEditModal
          task={null}
          defaults={taskDefaults}
          onClose={() => setTaskDefaults(null)}
        />
      )}
    </div>
  );
}
