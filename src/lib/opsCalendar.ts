import { isShipmentComplete } from "./types";
import type { Job, JobTracking, OpsTask, Quote } from "./types";

/** Local YYYY-MM-DD for a Y/M(0-based)/D triple — no timezone drift. */
export function iso(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m + 1)}-${p(d)}`;
}

export function todayIso(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Days between two ISO dates (b - a), calendar days. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * 6×7 grid of ISO date strings for the given month, Monday-first. Leading and
 * trailing cells spill into the neighbouring months.
 */
export function monthMatrix(year: number, month: number): string[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(year, month, 1 - offset);
  const weeks: string[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(iso(cur.getFullYear(), cur.getMonth(), cur.getDate()));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type CalKind = "etd" | "eta" | "task" | "note" | "quote-expiry" | "track-eta";

export interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalKind;
  label: string;
  sub: string;
  href: string;
}

export type CalSource = "jobs" | "tasks" | "quotes" | "tracking";
export const CAL_SOURCES: { key: CalSource; label: string }[] = [
  { key: "jobs", label: "Shipments ETD / ETA" },
  { key: "tasks", label: "Tasks & notes" },
  { key: "quotes", label: "Quote expiry" },
  { key: "tracking", label: "Tracking ETA" },
];

export const CAL_KIND_LABEL: Record<CalKind, string> = {
  etd: "ETD",
  eta: "ETA",
  task: "Task",
  note: "Note",
  "quote-expiry": "Quote",
  "track-eta": "Tracked ETA",
};

interface BuildArgs {
  jobs: Job[];
  tasks: OpsTask[];
  quotes: Quote[];
  trackings: JobTracking[];
  sources: Set<CalSource>;
}

const d10 = (s: string | null | undefined): string | null =>
  s ? s.slice(0, 10) : null;

/** Flatten everything dated in the system into calendar events. */
export function buildCalendarEvents({
  jobs,
  tasks,
  quotes,
  trackings,
  sources,
}: BuildArgs): CalEvent[] {
  const out: CalEvent[] = [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  if (sources.has("jobs")) {
    for (const j of jobs) {
      if (isShipmentComplete(j)) continue;
      const lane = `${j.mode} · ${j.client?.company ?? "—"}`;
      const etd = d10(j.etd);
      const eta = d10(j.eta);
      if (etd)
        out.push({ id: `${j.id}-etd`, date: etd, kind: "etd", label: `ETD ${j.reference}`, sub: lane, href: "/jobs" });
      if (eta)
        out.push({ id: `${j.id}-eta`, date: eta, kind: "eta", label: `ETA ${j.reference}`, sub: lane, href: "/jobs" });
    }
  }

  if (sources.has("tracking")) {
    for (const t of trackings) {
      const eta = d10(t.eta);
      if (!eta) continue;
      const j = jobById.get(t.job_id);
      out.push({
        id: `${t.job_id}-teta`,
        date: eta,
        kind: "track-eta",
        label: `ETA ${j?.reference ?? "shipment"}`,
        sub: `${t.carrier ?? "carrier —"} · ${t.status ?? "in transit"}`,
        href: "/ops?tab=tracking",
      });
    }
  }

  if (sources.has("tasks")) {
    for (const tk of tasks) {
      const due = d10(tk.due_date);
      if (!due || tk.status === "done") continue;
      out.push({
        id: `task-${tk.id}`,
        date: due,
        kind: tk.kind === "note" ? "note" : "task",
        label: tk.title,
        sub:
          tk.job?.reference ??
          tk.quote?.reference ??
          tk.client?.company ??
          (tk.priority === "high" ? "High priority" : "Control tower"),
        href: "/ops?tab=tasks",
      });
    }
  }

  if (sources.has("quotes")) {
    for (const q of quotes) {
      const exp = d10(q.valid_until);
      if (!exp || q.status === "accepted" || q.status === "lost") continue;
      out.push({
        id: `quote-${q.id}`,
        date: exp,
        kind: "quote-expiry",
        label: `${q.reference} expires`,
        sub: q.client?.company ?? "—",
        href: "/quotes",
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
