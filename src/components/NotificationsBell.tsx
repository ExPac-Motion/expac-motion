import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  useFollowUpLog,
  useJobs,
  useLeads,
  useMailCampaigns,
  useOpportunities,
  useOpsTasks,
  useQuotes,
} from "../lib/hooks";
import { timeAgo } from "../lib/format";

type Domain = "sales" | "shipments" | "operations" | "mail";

interface Note {
  id: string;
  domain: Domain;
  text: string;
  when: string;
  to: string;
}

const BELL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 21a2 2 0 004 0" />
  </svg>
);

const DOMAIN_ICON: Record<Domain, ReactNode> = {
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

const SEEN_KEY = "notif.lastSeen";
const DAY = 86_400_000;

function readSeen(): number {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) return Number(v) || 0;
  } catch {
    /* private mode */
  }
  // First run: treat everything already there as seen.
  const now = Date.now();
  try {
    localStorage.setItem(SEEN_KEY, String(now));
  } catch {
    /* ignore */
  }
  return now;
}

/** Bell in the top nav. Builds a live feed from data the app already loads
 *  (new leads, won quotes, new shipments, due tasks, sent campaigns and
 *  follow-ups) and badges anything newer than the last time it was opened. */
export default function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number>(readSeen);
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

  const notes = useMemo<Note[]>(() => {
    const cutoff = now - 30 * DAY;
    const recent = (iso: string | null | undefined) =>
      !!iso && new Date(iso).getTime() >= cutoff;
    const out: Note[] = [];

    for (const l of leads ?? [])
      if (recent(l.created_at))
        out.push({
          id: `lead-${l.id}`,
          domain: "sales",
          text: `New lead — ${l.company}`,
          when: l.created_at,
          to: "/crm?tab=leads",
        });

    for (const q of quotes ?? []) {
      if (recent(q.accepted_at))
        out.push({
          id: `qwon-${q.id}`,
          domain: "sales",
          text: `Quote won — ${q.reference}`,
          when: q.accepted_at as string,
          to: `/quotes/${q.id}`,
        });
    }

    for (const o of opps ?? [])
      if (o.status === "job_completed" && recent(o.updated_at))
        out.push({
          id: `oppwon-${o.id}`,
          domain: "sales",
          text: `Opportunity delivered — ${
            o.lead?.company ?? o.client?.company ?? "opportunity"
          }`,
          when: o.updated_at,
          to: "/crm?tab=opportunities",
        });

    for (const j of jobs ?? [])
      if (recent(j.created_at))
        out.push({
          id: `job-${j.id}`,
          domain: "shipments",
          text: `New shipment — ${j.reference}`,
          when: j.created_at,
          to: "/jobs",
        });

    const todayEnd = new Date(now).setHours(23, 59, 59, 999);
    for (const t of tasks ?? [])
      if (
        t.status !== "done" &&
        t.due_date &&
        new Date(t.due_date).getTime() <= todayEnd
      )
        out.push({
          id: `task-${t.id}`,
          domain: "operations",
          text: `${
            new Date(t.due_date).getTime() < now - DAY
              ? "Overdue task"
              : "Task due"
          } — ${t.title}`,
          when: t.due_date,
          to: "/ops?tab=tasks",
        });

    for (const c of campaigns ?? [])
      if (recent(c.sent_at))
        out.push({
          id: `camp-${c.id}`,
          domain: "mail",
          text: `Campaign sent — ${c.name}`,
          when: c.sent_at as string,
          to: "/crm?tab=campaigns",
        });

    for (const f of followUps ?? [])
      if (recent(f.created_at))
        out.push({
          id: `fu-${f.id}`,
          domain: "mail",
          text:
            f.status === "failed"
              ? `Follow-up failed — ${f.email}`
              : `Follow-up sent — ${f.email}`,
          when: f.created_at,
          to: "/crm?tab=followups",
        });

    out.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    // Cap each domain so one bulk action (e.g. a lead CSV import) can't bury
    // everything else, then cap the whole list.
    const perDomain: Record<Domain, number> = {
      sales: 0,
      shipments: 0,
      operations: 0,
      mail: 0,
    };
    const capped = out.filter((n) => {
      if (perDomain[n.domain] >= 12) return false;
      perDomain[n.domain] += 1;
      return true;
    });
    return capped.slice(0, 40);
  }, [now, leads, quotes, jobs, opps, tasks, campaigns, followUps]);

  const unread = notes.filter((n) => new Date(n.when).getTime() > seen).length;

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function markAllRead() {
    const now = Date.now();
    setSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      /* ignore */
    }
  }

  function openPanel() {
    const next = !open;
    setOpen(next);
    // let the unread highlight show for a beat, then clear the badge
    if (next && unread > 0) window.setTimeout(markAllRead, 1200);
  }

  function go(n: Note) {
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
        {unread > 0 && <span className="notif-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            {notes.length > 0 && (
              <button className="link-btn" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-list">
            {notes.length === 0 ? (
              <p className="notif-empty">You’re all caught up.</p>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  className={`notif-item${
                    new Date(n.when).getTime() > seen ? " unread" : ""
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
        </div>
      )}
    </div>
  );
}
