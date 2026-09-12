import type {
  FollowUpLogEntry,
  Job,
  Lead,
  MailCampaign,
  Message,
  Opportunity,
  OpsTask,
  Quote,
  ShipmentDocument,
} from "./types";

export type NotificationDomain = "sales" | "shipments" | "operations" | "mail";

export interface NotificationItem {
  /** Stable id — what notification_state rows key off. */
  key: string;
  domain: NotificationDomain;
  text: string;
  /** ISO timestamp this notification is anchored to. */
  when: string;
  /** Where clicking the notification navigates. */
  to: string;
  /** Passed as `{ state }` to navigate() -- the target page reads this to
   *  pop the specific record open, not just land on the list. */
  navState?: Record<string, unknown>;
  jobId?: string | null;
  quoteId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
}

export interface NotificationSources {
  leads?: Lead[];
  quotes?: Quote[];
  jobs?: Job[];
  opportunities?: Opportunity[];
  tasks?: OpsTask[];
  campaigns?: MailCampaign[];
  followUps?: FollowUpLogEntry[];
  /** All shipment messages (both directions), not just unread. */
  messages?: Message[];
  documents?: ShipmentDocument[];
}

const DAY = 86_400_000;
const LOOKBACK_DAYS = 30;

/**
 * Builds the system-wide notification feed from data the app already loads
 * elsewhere (leads, quotes, jobs + their job_events, opportunities, tasks,
 * campaigns, follow-ups, messages, documents) -- there is no persisted
 * event log, this is computed fresh each time. Shared by the top-nav bell
 * and the full Notifications tab so the two views can't drift apart.
 */
export function buildNotifications(
  now: number,
  src: NotificationSources,
): NotificationItem[] {
  const cutoff = now - LOOKBACK_DAYS * DAY;
  const recent = (iso: string | null | undefined) =>
    !!iso && new Date(iso).getTime() >= cutoff;
  const out: NotificationItem[] = [];

  for (const l of src.leads ?? []) {
    if (recent(l.created_at)) {
      out.push({
        key: `lead-${l.id}`,
        domain: "sales",
        text: `New lead — ${l.company}`,
        when: l.created_at,
        to: "/crm?tab=leads",
        navState: { openLeadId: l.id },
        leadId: l.id,
      });
    }
    if (recent(l.promoted_at)) {
      out.push({
        key: `leadpromo-${l.id}`,
        domain: "sales",
        text: `Lead converted to customer — ${l.company}`,
        when: l.promoted_at as string,
        to: "/clients",
        navState: l.promoted_client_id
          ? { openContactId: l.promoted_client_id }
          : undefined,
        leadId: l.id,
        clientId: l.promoted_client_id,
      });
    }
  }

  for (const q of src.quotes ?? []) {
    if (recent(q.accepted_at)) {
      out.push({
        key: `qwon-${q.id}`,
        domain: "sales",
        text: `Quote won — ${q.reference}`,
        when: q.accepted_at as string,
        to: `/quotes/${q.id}`,
        quoteId: q.id,
        clientId: q.client_id,
      });
    }
  }

  for (const o of src.opportunities ?? [])
    if (o.status === "job_completed" && recent(o.updated_at))
      out.push({
        key: `oppwon-${o.id}`,
        domain: "sales",
        text: `Opportunity delivered — ${
          o.lead?.company ?? o.client?.company ?? "opportunity"
        }`,
        when: o.updated_at,
        to: "/crm?tab=opportunities",
        navState: { openOpportunityId: o.id },
        clientId: o.client_id,
        leadId: o.lead_id,
      });

  const jobById = new Map((src.jobs ?? []).map((j) => [j.id, j]));

  for (const j of src.jobs ?? []) {
    if (recent(j.created_at)) {
      out.push({
        key: `job-${j.id}`,
        domain: "shipments",
        text: `New shipment — ${j.reference}`,
        when: j.created_at,
        to: "/jobs",
        navState: { openJobId: j.id },
        jobId: j.id,
        clientId: j.client_id,
        quoteId: j.quote_id,
      });
    }
    for (const e of j.job_events ?? [])
      if (recent(e.created_at))
        out.push({
          key: `jobevent-${e.id}`,
          domain: "shipments",
          text: `${j.reference} — ${e.note || `moved to ${e.milestone}`}`,
          when: e.created_at,
          to: "/jobs",
          navState: { openJobId: j.id },
          jobId: j.id,
          clientId: j.client_id,
        });
  }

  const todayEnd = new Date(now).setHours(23, 59, 59, 999);
  for (const t of src.tasks ?? [])
    if (
      t.status !== "done" &&
      t.due_date &&
      new Date(t.due_date).getTime() <= todayEnd
    )
      out.push({
        key: `task-${t.id}`,
        domain: "operations",
        text: `${
          new Date(t.due_date).getTime() < now - DAY ? "Overdue task" : "Task due"
        } — ${t.title}`,
        when: t.due_date,
        to: "/ops?tab=tasks",
        navState: { openTaskId: t.id },
        jobId: t.job_id,
        quoteId: t.quote_id,
        clientId: t.client_id,
      });

  for (const c of src.campaigns ?? [])
    if (recent(c.sent_at))
      out.push({
        key: `camp-${c.id}`,
        domain: "mail",
        text: `Campaign sent — ${c.name}`,
        when: c.sent_at as string,
        to: "/crm?tab=campaigns",
      });

  for (const m of src.messages ?? []) {
    if (!recent(m.created_at)) continue;
    const j = jobById.get(m.job_id);
    out.push({
      key: `msg-${m.id}`,
      domain: "mail",
      text:
        m.direction === "in"
          ? `New reply — ${j?.reference ?? "shipment"}`
          : `Sent — ${m.subject || "email"} (${j?.reference ?? "shipment"})`,
      when: m.created_at,
      to: "/jobs",
      navState: { openJobId: m.job_id, openComms: true },
      jobId: m.job_id,
      clientId: j?.client_id ?? null,
    });
  }

  for (const d of src.documents ?? [])
    if (recent(d.created_at)) {
      const j = jobById.get(d.job_id);
      out.push({
        key: `doc-${d.id}`,
        domain: "shipments",
        text: `Document uploaded — ${d.name} (${j?.reference ?? "shipment"})`,
        when: d.created_at,
        to: "/jobs",
        navState: { openJobId: d.job_id },
        jobId: d.job_id,
        clientId: j?.client_id ?? null,
      });
    }

  for (const f of src.followUps ?? [])
    if (recent(f.created_at))
      out.push({
        key: `fu-${f.id}`,
        domain: "mail",
        text:
          f.status === "failed"
            ? `Follow-up failed — ${f.email}`
            : `Follow-up sent — ${f.email}`,
        when: f.created_at,
        to: "/crm?tab=followups",
        leadId: f.lead_id,
      });

  out.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  return out;
}
