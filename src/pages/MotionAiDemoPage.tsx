// DEV only: /dev/motion-ai, the Motion AI panel open over a copy of the top
// bar, with sample turns, to check its look without signing in.

import { MotionAiPanel } from "../components/MotionAiPanel";

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
        ]}
      />
    </div>
  );
}
