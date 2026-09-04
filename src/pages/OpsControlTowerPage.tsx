import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common";
import {
  useJobTracking,
  useJobs,
  useOpsTasks,
  useQuotes,
} from "../lib/hooks";
import { todayIso } from "../lib/opsCalendar";
import { trackableRef, trackingTone } from "../lib/tracking";
import { isShipmentComplete } from "../lib/types";
import TasksNotes from "./ops/TasksNotes";
import CalendarBoard from "./ops/CalendarBoard";
import LiveTracking from "./ops/LiveTracking";

type Tab = "tasks" | "calendar" | "tracking";
const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Tasks & Notes" },
  { key: "calendar", label: "Calendar" },
  { key: "tracking", label: "Live Tracking" },
];

interface Chip {
  label: string;
  n: number;
  alert?: boolean;
  go: () => void;
}

export default function OpsControlTowerPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "tasks";
  const focus = params.get("focus") || undefined;

  const jobsQ = useJobs();
  const quotesQ = useQuotes();
  const tasksQ = useOpsTasks();
  const trackQ = useJobTracking();
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);
  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const trackings = useMemo(() => trackQ.data ?? [], [trackQ.data]);

  const setTab = useCallback(
    (next: Tab, extra?: Record<string, string>) => {
      setParams({ tab: next, ...extra });
    },
    [setParams],
  );

  const chips = useMemo<Chip[]>(() => {
    const today = todayIso();
    const in7 = new Date(new Date().getTime() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const activeJobs = jobs.filter((j) => !isShipmentComplete(j));
    const trackByJob = new Map(trackings.map((t) => [t.job_id, t]));

    const openTasks = tasks.filter((t) => t.kind === "task" && t.status !== "done");
    const overdue = openTasks.filter((t) => t.due_date && t.due_date < today).length;
    const dueToday = openTasks.filter((t) => t.due_date === today).length;

    const noStatus = activeJobs.filter(
      (j) => !j.shipment_status || j.shipment_status === "Booked",
    ).length;
    const noNumber = activeJobs.filter((j) => !trackableRef(j)).length;

    const arriving = activeJobs.filter((j) => {
      const eta = trackByJob.get(j.id)?.eta ?? j.eta;
      return eta && eta >= today && eta <= in7;
    }).length;
    const exceptions = activeJobs.filter((j) => {
      const t = trackByJob.get(j.id);
      return (
        j.shipment_status === "Customs Detained" ||
        trackingTone(t?.status) === "alert"
      );
    }).length;

    const expiring = quotes.filter(
      (q) =>
        q.status !== "accepted" &&
        q.valid_until &&
        q.valid_until >= today &&
        q.valid_until <= in7,
    ).length;
    const awaiting = quotes.filter(
      (q) => q.status === "sent" || q.status === "followup",
    ).length;

    return [
      { label: "Tasks overdue", n: overdue, alert: true, go: () => setTab("tasks", { focus: "overdue" }) },
      { label: "Tasks due today", n: dueToday, go: () => setTab("tasks", { focus: "today" }) },
      { label: "Shipments without status", n: noStatus, go: () => navigate("/jobs") },
      { label: "Shipments without a tracking no.", n: noNumber, go: () => navigate("/jobs") },
      { label: "Arriving ≤ 7 days", n: arriving, go: () => setTab("tracking") },
      { label: "Tracking exceptions", n: exceptions, alert: true, go: () => setTab("tracking") },
      { label: "Quotes expiring ≤ 7 days", n: expiring, alert: true, go: () => navigate("/quotes") },
      { label: "Quotes awaiting approval", n: awaiting, go: () => navigate("/quotes") },
    ].filter((c) => c.n > 0);
  }, [jobs, quotes, tasks, trackings, navigate, setTab]);

  return (
    <>
      <PageHeader eyebrow="Command centre" title="Control Tower" />

      {chips.length > 0 && (
        <div className="ct-band">
          {chips.map((c) => (
            <button
              key={c.label}
              className={`ct-chip${c.alert ? " alert" : ""}`}
              onClick={c.go}
            >
              <span className="ct-chip-n">{c.n}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="ct-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ct-tab${tab === t.key ? " on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "tasks" && <TasksNotes focus={focus} />}
      {tab === "calendar" && <CalendarBoard />}
      {tab === "tracking" && <LiveTracking />}
    </>
  );
}
