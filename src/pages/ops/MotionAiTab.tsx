// Control Tower › Motion AI (0215): every action the bots suggested, carded
// for approval or did on their own, with Approve / Reject / Undo, plus the
// month's AI spend. Live: new cards appear without a reload (realtime).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import MotionAiActionCard from "../../components/MotionAiActionCard";
import { ErrorNote, Loading } from "../../components/common";
import { formatDateTime } from "../../lib/format";
import { useProfiles } from "../../lib/hooks";
import {
  AI_STATUS_LABEL,
  getAiMonthSpend,
  getAiSettings,
  getLatestBriefing,
  listAiActions,
  listAiEvents,
  listAiTriggers,
  type AiActionStatus,
} from "../../lib/motionAi";
import { RichText } from "../../components/MotionAiPanel";

const EVENT_STATUS: Record<string, string> = {
  queued: "Waiting",
  running: "Running",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

const FILTERS: { key: "" | AiActionStatus; label: string }[] = [
  { key: "pending", label: "Awaiting approval" },
  { key: "", label: "All" },
  { key: "executed", label: "Done" },
  { key: "rejected", label: "Rejected" },
  { key: "undone", label: "Undone" },
  { key: "failed", label: "Failed" },
  { key: "suggested", label: "Suggested" },
];

export default function MotionAiTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"" | AiActionStatus>("pending");
  const actionsQ = useQuery({ queryKey: ["ai_actions"], queryFn: () => listAiActions({ limit: 300 }) });
  const spendQ = useQuery({ queryKey: ["ai_month_spend"], queryFn: getAiMonthSpend });
  const settingsQ = useQuery({ queryKey: ["ai_settings"], queryFn: getAiSettings });
  const profilesQ = useProfiles();
  const briefingQ = useQuery({ queryKey: ["ai_events", "briefing"], queryFn: getLatestBriefing });
  const eventsQ = useQuery({ queryKey: ["ai_events"], queryFn: () => listAiEvents(40) });
  const triggersQ = useQuery({ queryKey: ["ai_triggers"], queryFn: listAiTriggers });
  const [briefingOpen, setBriefingOpen] = useState(true);
  const triggerLabel = (k: string) => triggersQ.data?.find((t) => t.key === k)?.label ?? k;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profilesQ.data ?? []) m.set(p.id, p.full_name || p.email || "Team member");
    return m;
  }, [profilesQ.data]);

  const all = actionsQ.data ?? [];
  const shown = filter ? all.filter((a) => a.status === filter) : all;
  const today = new Date().toISOString().slice(0, 10);
  const count = (s: AiActionStatus) => all.filter((a) => a.status === s).length;
  const doneToday = all.filter((a) => a.status === "executed" && (a.executed_at ?? "").startsWith(today)).length;
  const spend = spendQ.data ?? 0;
  const budget = settingsQ.data?.monthly_budget_usd ?? 0;

  if (actionsQ.isLoading) return <Loading />;
  if (actionsQ.error) return <ErrorNote error={actionsQ.error} />;

  const briefing = briefingQ.data;
  const events = eventsQ.data ?? [];

  return (
    <div>
      {briefing && briefing.text && (
        <section className="mai-briefing">
          <div className="mai-briefing-head">
            <b>{briefing.conversation.title}</b>
            <button className="link-btn" onClick={() => setBriefingOpen((o) => !o)}>
              {briefingOpen ? "Hide" : "Show"}
            </button>
          </div>
          {briefingOpen && (
            <div className="mai-msg assistant mai-briefing-body">
              <RichText text={briefing.text} />
            </div>
          )}
        </section>
      )}
      <div className="mai-ovr-head">
        <div className="mai-ovr-stats">
          <div className="mai-stat">
            <b>{count("pending")}</b>Awaiting approval
          </div>
          <div className="mai-stat">
            <b>{doneToday}</b>Done today
          </div>
          <div className="mai-stat">
            <b>{count("failed")}</b>Failed
          </div>
          <div className="mai-stat" title="AI cost this month, in US dollars">
            <b>
              ${spend.toFixed(2)}
              {budget ? <span className="muted"> / ${Number(budget).toFixed(0)}</span> : null}
            </b>
            Spend this month
          </div>
        </div>
        <label>
          Show{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value as "" | AiActionStatus)}>
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
                {f.key ? ` (${count(f.key)})` : ` (${all.length})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="hint">
          {filter === "pending"
            ? "Nothing waiting for approval."
            : `No ${filter ? AI_STATUS_LABEL[filter].toLowerCase() : ""} actions yet.`}
        </p>
      ) : (
        <div className="mai-ovr-list">
          {shown.map((a) => (
            <div key={a.id}>
              <MotionAiActionCard
                action={a}
                compact
                onChange={() => {
                  void qc.invalidateQueries({ queryKey: ["ai_actions"] });
                }}
              />
              <div className="mai-ovr-meta">
                {formatDateTime(a.created_at)} ·{" "}
                {a.actor_type === "user"
                  ? `asked by ${names.get(a.requested_by ?? "") ?? "a team member"}`
                  : `trigger: ${a.trigger_key ?? a.actor_type}`}
                {a.decided_by && ` · decided by ${names.get(a.decided_by) ?? "a team member"}`}
                {a.undone_by && ` · undone by ${names.get(a.undone_by) ?? "a team member"}`}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="mai-runs-title">Automatic runs</h3>
      {events.length === 0 ? (
        <p className="hint">No automatic runs yet. They start once migration 0218 is applied (new leads, enquiries, status changes, follow-ups, the daily briefing).</p>
      ) : (
        <table className="mai-policy-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Trigger</th>
              <th>About</th>
              <th>Status</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.created_at)}</td>
                <td>{triggerLabel(e.trigger_key)}</td>
                <td>{String(e.payload?.reference ?? e.payload?.company ?? e.payload?.source ?? "")}</td>
                <td>
                  <span className={`mai-pill ${e.status === "done" ? "executed" : e.status === "failed" ? "failed" : e.status === "queued" || e.status === "running" ? "pending" : ""}`}>
                    {EVENT_STATUS[e.status] ?? e.status}
                  </span>
                </td>
                <td className="mai-run-outcome">{e.error ?? e.summary ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
