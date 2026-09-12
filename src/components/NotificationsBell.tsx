import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  useFollowUpLog,
  useJobs,
  useLeads,
  useMailCampaigns,
  useNotificationState,
  useOpportunities,
  useOpsTasks,
  useQuotes,
  useSetNotificationState,
  useUnreadMessages,
} from "../lib/hooks";
import { timeAgo } from "../lib/format";
import {
  buildNotifications,
  type NotificationDomain,
  type NotificationItem,
} from "../lib/notifications";
import type { Message } from "../lib/types";

const BELL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 21a2 2 0 004 0" />
  </svg>
);

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

/** Bell in the top nav. Shares its feed logic (src/lib/notifications.ts) with
 *  the full Notifications tab, and the same per-item read state
 *  (notification_state) -- this dropdown is just a lightweight recent-unread
 *  view onto the same data, not a second implementation. */
export default function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Snapshot "now" once per mount — keeps the feed calc pure across re-renders.
  const [now] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  const leads = useLeads().data;
  const quotes = useQuotes().data;
  const jobs = useJobs().data;
  const opps = useOpportunities().data;
  const tasks = useOpsTasks().data;
  const campaigns = useMailCampaigns().data;
  const followUps = useFollowUpLog().data;
  const unreadMessages = useUnreadMessages().data;
  const stateQ = useNotificationState();
  const setState = useSetNotificationState();

  const stateByKey = useMemo(() => {
    const m = new Map<string, { read_at: string | null; archived_at: string | null }>();
    for (const s of stateQ.data ?? []) m.set(s.notification_key, s);
    return m;
  }, [stateQ.data]);

  const items = useMemo<NotificationItem[]>(() => {
    // Unread inbound replies only, in the shape buildNotifications expects —
    // keeps the bell's own query lightweight (no full messages/documents
    // fetch here; the full Notifications tab covers those).
    const messages: Message[] = (unreadMessages ?? []).map((m) => ({
      ...m,
      direction: "in",
      subject: null,
    })) as Message[];
    return buildNotifications(now, {
      leads,
      quotes,
      jobs,
      opportunities: opps,
      tasks,
      campaigns,
      followUps,
      messages,
    });
  }, [now, leads, quotes, jobs, opps, tasks, campaigns, followUps, unreadMessages]);

  const visible = items.filter((n) => !stateByKey.get(n.key)?.archived_at);
  const unread = visible.filter((n) => !stateByKey.get(n.key)?.read_at);

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function markRead(keys: string[]) {
    const now2 = new Date().toISOString();
    for (const key of keys) setState.mutate({ key, patch: { read_at: now2 } });
  }

  function openPanel() {
    const next = !open;
    setOpen(next);
    // let the unread highlight show for a beat, then clear the badge
    if (next && unread.length > 0) {
      window.setTimeout(() => markRead(unread.map((n) => n.key)), 1200);
    }
  }

  function go(n: NotificationItem) {
    markRead([n.key]);
    navigate(n.to);
    setOpen(false);
  }

  return (
    <div className="notif" ref={ref}>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        title="Notifications"
        aria-label="Notifications"
        onClick={openPanel}
      >
        {BELL}
        {unread.length > 0 && (
          <span className="notif-badge">{unread.length > 9 ? "9+" : unread.length}</span>
        )}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {visible.length > 0 && (
              <button
                className="link-btn"
                onClick={() => markRead(visible.map((n) => n.key))}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-list">
            {visible.length === 0 ? (
              <p className="notif-empty">You’re all caught up.</p>
            ) : (
              visible.slice(0, 40).map((n) => (
                <button
                  key={n.key}
                  className={`notif-item${
                    !stateByKey.get(n.key)?.read_at ? " unread" : ""
                  }`}
                  onClick={() => go(n)}
                >
                  <span className={`notif-ico ${n.domain}`}>
                    {DOMAIN_ICON[n.domain]}
                  </span>
                  <span className="notif-text">{n.text}</span>
                  <span className="notif-when">{timeAgo(n.when)}</span>
                </button>
              ))
            )}
          </div>
          <div className="notif-panel-foot">
            <button
              className="link-btn"
              onClick={() => {
                setOpen(false);
                navigate("/ops?tab=notifications");
              }}
            >
              View all notifications →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
