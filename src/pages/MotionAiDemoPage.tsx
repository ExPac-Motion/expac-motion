// DEV only: /dev/motion-ai, the Motion AI panel open over a copy of the top
// bar, with sample turns, to check its look without signing in.

import { MotionAiPanel } from "../components/MotionAiPanel";
import type { AiAction, AiActionStatus } from "../lib/motionAi";

function demoAction(tool: string, status: AiActionStatus, summary: string, input: Record<string, unknown>): AiAction {
  return {
    id: `demo-${tool}`,
    created_at: new Date().toISOString(),
    bot_key: "ops",
    conversation_id: null,
    tool,
    summary,
    input,
    edited_input: null,
    level: status === "executed" ? "auto" : "draft",
    status,
    target_type: null,
    target_id: null,
    target_ref: null,
    actor_type: "user",
    requested_by: null,
    trigger_key: null,
    decided_by: null,
    decided_at: null,
    reject_reason: null,
    executed_at: status === "executed" ? new Date().toISOString() : null,
    result: null,
    undo: status === "executed" ? { job_id: "x", status: "Departed" } : null,
    undone_by: null,
    undone_at: null,
    error: null,
  };
}

const TABS = ["Dashboard", "Control Tower", "Shipments", "Quotations", "Customers", "Sales CRM"];

export default function MotionAiDemoPage() {
  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <span className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </span>
        <nav className="topbar-primary">
          {TABS.map((t, i) => (
            <span key={t} className={`topbar-tab${i === 1 ? " active" : ""}`}>
              {t}
            </span>
          ))}
        </nav>
      </header>
      <main className="main">
        <p>Page content sits here.</p>
      </main>
      <MotionAiPanel
        onClose={() => undefined}
        initialTurns={[
          { key: "1", role: "user", text: "Which shipments arrive in the next 5 days?" },
          {
            key: "2",
            role: "assistant",
            text: "**3 shipments arrive in the next 5 days:**\n- **SEA104512**, Acme Imports, Shanghai to Durban, ETA 07/11/2026, In Transit\n- **AIR100388**, Bright Foods, Frankfurt to Johannesburg, ETA 06/11/2026, Departed\n- **SEA104477**, Coastal Steel, Ningbo to Durban, ETA 09/11/2026, In Transit\n\nSEA104477 has no clearing agent yet. Want me to set a task?",
          },
          { key: "3", role: "user", text: "Yes, task for Thandi due Friday. And AIR100388 has arrived." },
          { key: "4", role: "action", text: "", action: demoAction("create_task", "pending", 'New task: "Appoint a clearing agent", on SEA104477, due 06/11/2026, for Thandi', { title: "Appoint a clearing agent", due_date: "2026-11-06", priority: "high" }) },
          { key: "5", role: "action", text: "", action: demoAction("update_shipment_status", "executed", 'Set AIR100388 from "Departed" to "Arrived"', { status: "Arrived" }) },
          {
            key: "6",
            role: "assistant",
            text: "The task is waiting for your Approve. AIR100388 is set to Arrived (that action is on Auto); you can Undo it on the card.",
          },
        ]}
      />
    </div>
  );
}
