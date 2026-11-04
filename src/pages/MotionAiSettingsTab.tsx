// Settings › Motion AI (0214 / 0215): models, spend cap, autonomy level per
// action with its trust scorecard, and the Operations bot's instructions.
// Admins edit; everyone else with access sees it read-only.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorNote, Loading } from "../components/common";
import TimeInput from "../components/TimeInput";
import { useMyProfile } from "../lib/hooks";
import {
  AI_LEVEL_LABEL,
  AI_MODEL_CHOICES,
  AI_TASK_LABEL,
  getAiMonthSpend,
  getAiSettings,
  listAiBots,
  listAiPolicies,
  listAiScorecard,
  listAiTriggers,
  setAiTriggerEnabled,
  saveAiBotPrompt,
  saveAiSettings,
  setAiPolicyLevel,
  type AiLevel,
  type AiSettingsRow,
} from "../lib/motionAi";

/** Approvals in a row (no edits / rejections / undos) before suggesting Auto. */
const READY_STREAK = 30;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TRIGGER_WHEN: Record<string, string> = {
  daily_briefing: "At the briefing time on the briefing days",
  new_lead: "A lead is added",
  new_enquiry: "A website form, website quote request or portal request comes in",
  status_change: "A shipment turns Arrived, Customs, Detained, Released or Delivered",
  quote_follow_up: "A sent quote has no answer after 3 days (weekly, working hours)",
  eta_overdue: "ETA passed and not Arrived (daily, working hours)",
  tasks_overdue: "Weekdays from 10:00, when tasks are overdue",
};

export default function MotionAiSettingsTab() {
  const qc = useQueryClient();
  const isAdmin = useMyProfile().data?.role === "admin";
  const settingsQ = useQuery({ queryKey: ["ai_settings"], queryFn: getAiSettings });
  const policiesQ = useQuery({ queryKey: ["ai_policies"], queryFn: listAiPolicies });
  const scoreQ = useQuery({ queryKey: ["ai_scorecard"], queryFn: listAiScorecard });
  const spendQ = useQuery({ queryKey: ["ai_month_spend"], queryFn: getAiMonthSpend });
  const botsQ = useQuery({ queryKey: ["ai_bots"], queryFn: listAiBots });
  const triggersQ = useQuery({ queryKey: ["ai_triggers"], queryFn: listAiTriggers });

  const [form, setForm] = useState<AiSettingsRow | null>(null);
  const [prompt, setPrompt] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const opsBot = botsQ.data?.find((b) => b.key === "ops");

  useEffect(() => {
    if (settingsQ.data) setForm(settingsQ.data);
  }, [settingsQ.data]);
  useEffect(() => {
    if (opsBot) setPrompt(opsBot.system_prompt);
  }, [opsBot]);

  if (settingsQ.isLoading || !form) return <Loading />;
  if (settingsQ.error) {
    return <ErrorNote error={new Error(`Motion AI settings aren't available: ${settingsQ.error.message}. They need migrations 0214 and 0215.`)} />;
  }

  async function run(fn: () => Promise<void>, ok: string, keys: string[]) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const f = form;
  const set = (patch: Partial<AiSettingsRow>) => setForm({ ...f, ...patch });
  const score = (action: string) => scoreQ.data?.find((s) => s.bot_key === "ops" && s.action === action);
  const spend = spendQ.data ?? 0;

  return (
    <>
      {!isAdmin && <p className="hint">Only an Admin can change these settings.</p>}
      {msg && <p className="hint">{msg}</p>}
      {err && <ErrorNote error={new Error(err)} />}

      <section className="mai-set-section">
        <h3>General</h3>
        <p className="muted">
          Spend this month: <b>${spend.toFixed(2)}</b> of ${Number(f.monthly_budget_usd).toFixed(0)} (US dollars). When the
          cap is reached, automatic runs pause; the chat keeps working.
        </p>
        <div className="mai-set-grid">
          <label>
            Motion AI
            <select value={f.enabled ? "on" : "off"} disabled={!isAdmin} onChange={(e) => set({ enabled: e.target.value === "on" })}>
              <option value="on">On</option>
              <option value="off">Off (everything paused)</option>
            </select>
          </label>
          {Object.keys(AI_TASK_LABEL).map((task) => (
            <label key={task}>
              Model: {AI_TASK_LABEL[task]}
              <select
                value={f.models?.[task] ?? ""}
                disabled={!isAdmin}
                onChange={(e) => set({ models: { ...f.models, [task]: e.target.value } })}
              >
                {!AI_MODEL_CHOICES.some((m) => m.id === f.models?.[task]) && f.models?.[task] && (
                  <option value={f.models[task]}>{f.models[task]}</option>
                )}
                {AI_MODEL_CHOICES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Thinking effort
            <select value={f.effort} disabled={!isAdmin} onChange={(e) => set({ effort: e.target.value as AiSettingsRow["effort"] })}>
              <option value="low">Low (fastest, cheapest)</option>
              <option value="medium">Medium</option>
              <option value="high">High (most careful)</option>
            </select>
          </label>
          <label>
            Monthly spend cap (USD)
            <input
              type="number"
              min={0}
              step={10}
              value={f.monthly_budget_usd}
              disabled={!isAdmin}
              onChange={(e) => set({ monthly_budget_usd: Number(e.target.value) })}
            />
          </label>
          <label>
            Daily briefing time
            <TimeInput value={f.briefing_time?.slice(0, 5) ?? "05:00"} onChange={(v) => set({ briefing_time: v })} disabled={!isAdmin} />
          </label>
          <label>
            Briefing days
            <span className="mai-card-actions">
              {DAYS.map((d, i) => {
                const n = i + 1;
                const on = f.briefing_days?.includes(n);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`btn btn-sm${on ? "" : " outline"}`}
                    disabled={!isAdmin}
                    onClick={() =>
                      set({ briefing_days: on ? f.briefing_days.filter((x) => x !== n) : [...(f.briefing_days ?? []), n].sort() })
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </span>
          </label>
        </div>
        {isAdmin && (
          <p>
            <button
              className="btn"
              onClick={() =>
                run(
                  () =>
                    saveAiSettings({
                      enabled: f.enabled,
                      models: f.models,
                      effort: f.effort,
                      monthly_budget_usd: f.monthly_budget_usd,
                      briefing_time: f.briefing_time,
                      briefing_days: f.briefing_days,
                    }),
                  "Settings saved.",
                  ["ai_settings"],
                )
              }
            >
              Save settings
            </button>
          </p>
        )}
      </section>

      <section className="mai-set-section">
        <h3>Triggers and schedules</h3>
        <p className="muted">
          What makes Motion AI run on its own. Each run's result is an approval card or a short report in the Motion AI
          panel and Control Tower › Motion AI. Switch any of them off here.
        </p>
        {triggersQ.error ? (
          <ErrorNote error={new Error(`Triggers need migration 0218: ${triggersQ.error.message}`)} />
        ) : (
          <table className="mai-policy-table">
            <thead>
              <tr>
                <th>Trigger</th>
                <th>When</th>
                <th>On</th>
              </tr>
            </thead>
            <tbody>
              {(triggersQ.data ?? []).map((t) => (
                <tr key={t.key}>
                  <td title={t.instruction}>{t.label}</td>
                  <td className="muted">{TRIGGER_WHEN[t.key] ?? (t.kind === "schedule" ? "On a schedule" : "When it happens")}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      disabled={!isAdmin}
                      onChange={(e) =>
                        run(() => setAiTriggerEnabled(t.key, e.target.checked), `${t.label}: ${e.target.checked ? "on" : "off"}.`, [
                          "ai_triggers",
                        ])
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mai-set-section">
        <h3>Autonomy levels</h3>
        <p className="muted">
          What Motion AI may do on its own. Everything starts at Draft for approval. When an action has {READY_STREAK} approvals in a
          row with no edits, rejections or undos, it is marked ready for Auto; moving it is still your call. Emails to customers and
          suppliers always need your approval.
        </p>
        {policiesQ.error ? (
          <ErrorNote error={policiesQ.error} />
        ) : (
          <table className="mai-policy-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Level</th>
                <th className="num">Approved</th>
                <th className="num">Edited</th>
                <th className="num">Rejected</th>
                <th className="num">Undone</th>
                <th className="num">In a row</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(policiesQ.data ?? [])
                .filter((p) => p.bot_key === "ops")
                .map((p) => {
                  const s = score(p.action);
                  return (
                    <tr key={p.action}>
                      <td>{p.label}</td>
                      <td>
                        <select
                          value={p.level}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            run(() => setAiPolicyLevel(p.bot_key, p.action, e.target.value as AiLevel), `${p.label}: ${AI_LEVEL_LABEL[e.target.value as AiLevel]}.`, [
                              "ai_policies",
                            ])
                          }
                        >
                          {(["suggest", "draft", "auto"] as AiLevel[]).map((l) => (
                            <option key={l} value={l} disabled={l === "auto" && p.locked}>
                              {AI_LEVEL_LABEL[l]}
                              {l === "auto" && p.locked ? " (locked)" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num">{s?.approved_as_is ?? 0}</td>
                      <td className="num">{s?.approved_edited ?? 0}</td>
                      <td className="num">{s?.rejected ?? 0}</td>
                      <td className="num">{s?.undone ?? 0}</td>
                      <td className="num">{s?.streak ?? 0}</td>
                      <td>
                        {p.level !== "auto" && !p.locked && (s?.streak ?? 0) >= READY_STREAK && (
                          <span className="mai-ready">Ready for Auto</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>

      <section className="mai-set-section">
        <h3>Operations bot instructions</h3>
        <p className="muted">
          How the Operations bot behaves. Changes apply to the next message. Keep the rules short and plain.
        </p>
        <textarea className="mai-prompt" value={prompt} disabled={!isAdmin} onChange={(e) => setPrompt(e.target.value)} />
        {isAdmin && (
          <p>
            <button
              className="btn"
              disabled={!prompt.trim() || prompt === opsBot?.system_prompt}
              onClick={() => run(() => saveAiBotPrompt("ops", prompt), "Instructions saved.", ["ai_bots"])}
            >
              Save instructions
            </button>
          </p>
        )}
      </section>
    </>
  );
}
