// Settings › Appearance: the ExPac brand palette, buttons, badges, type and
// layout tokens as Motion actually renders them. Colours are read live from
// the :root CSS variables in index.css, so this page never drifts from the app.
import { useEffect, useState, type ReactNode } from "react";
import { useToast } from "../components/Toast";

type Swatch = { v: string; name: string; use: string };

const CORE: Swatch[] = [
  { v: "--green", name: "ExPac Green", use: "Primary buttons, active states, Done" },
  { v: "--ink", name: "Ink", use: "Body text, text on green" },
  { v: "--night", name: "Night", use: "Top bar, ghost buttons, headings on light" },
  { v: "--paper", name: "Paper", use: "Page background" },
  { v: "--teal", name: "Teal", use: "Secondary actions, In progress, Sent" },
  { v: "--amber", name: "Amber", use: "Bulk edit, attention, portal asks" },
  { v: "--orange", name: "Orange-red", use: "Warnings, danger, At risk, Lost" },
];

const FAMILIES: { title: string; use: string; vars: { v: string; role: string }[] }[] = [
  {
    title: "Green",
    use: "Primary",
    vars: [
      { v: "--green", role: "Base" },
      { v: "--green-dark", role: "Ink" },
      { v: "--green-tint", role: "Tint" },
    ],
  },
  {
    title: "Teal",
    use: "Secondary",
    vars: [
      { v: "--teal", role: "Base" },
      { v: "--teal-ink", role: "Ink" },
      { v: "--teal-tint", role: "Tint" },
    ],
  },
  {
    title: "Amber",
    use: "Bulk / attention",
    vars: [
      { v: "--amber", role: "Base" },
      { v: "--amber-ink", role: "Ink" },
      { v: "--amber-tint", role: "Tint" },
    ],
  },
  {
    title: "Orange-red",
    use: "Warning / danger",
    vars: [
      { v: "--orange", role: "Base" },
      { v: "--orange-ink", role: "Ink" },
      { v: "--orange-tint", role: "Tint" },
    ],
  },
  {
    title: "Night",
    use: "Dark surfaces",
    vars: [
      { v: "--night", role: "Base" },
      { v: "--night-tint", role: "Tint" },
    ],
  },
  {
    title: "Blue (legacy)",
    use: "On Delivery, Courier only",
    vars: [
      { v: "--blue", role: "Base" },
      { v: "--blue-ink", role: "Ink" },
      { v: "--blue-tint", role: "Tint" },
    ],
  },
];

const NEUTRALS: Swatch[] = [
  { v: "--white", name: "White", use: "Panels, inputs, outline buttons" },
  { v: "--muted", name: "Muted", use: "Hints, secondary text" },
  { v: "--line", name: "Line", use: "Borders, dividers" },
];

function readVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Normalise any CSS colour (#fff, rgb(), rgba()) to #RRGGBB, keeping alpha as a %. */
function toHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ("#" + [...v.slice(1)].map((c) => c + c).join("")).toUpperCase();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = v.match(/rgba?\(([^)]+)\)/i);
  if (!m) return v;
  const [r, g, b, a] = m[1].split(",").map((s) => parseFloat(s));
  const hex = "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return a !== undefined && a < 1 ? `${hex} · ${Math.round(a * 100)}%` : hex;
}

function useTokens(names: string[]) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = names.join("|");
  useEffect(() => {
    const out: Record<string, string> = {};
    for (const n of key.split("|")) out[n] = readVar(n);
    setVals(out);
  }, [key]);
  return vals;
}

export default function AppearanceSettingsTab() {
  const { toast } = useToast();
  const all = [
    ...new Set([
      ...CORE.map((s) => s.v),
      ...FAMILIES.flatMap((f) => f.vars.map((x) => x.v)),
      ...NEUTRALS.map((s) => s.v),
      "--radius",
      "--shadow",
      "--display",
      "--body",
    ]),
  ];
  const t = useTokens(all);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${text}`);
    } catch {
      toast(text);
    }
  }

  const hex = (v: string) => (t[v] ? toHex(t[v]) : "");

  return (
    <div className="appr">
      <p className="muted" style={{ marginTop: 0 }}>
        The ExPac brand as Motion uses it. Click any colour to copy its hex code. Values are read live from the app's
        stylesheet, so this always matches what's on screen.
      </p>

      <section className="appr-section">
        <h3>Brand colours</h3>
        <div className="appr-core">
          {CORE.map((s) => (
            <button key={s.v} type="button" className="appr-swatch" onClick={() => copy(hex(s.v))}>
              <span className="appr-chip" style={{ background: `var(${s.v})` }} />
              <span className="appr-meta">
                <b>{s.name}</b>
                <code>{hex(s.v)}</code>
                <small>{s.use}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="appr-section">
        <h3>Colour families</h3>
        <p className="hint">
          Each accent has a <b>base</b> (fills, borders), an <b>ink</b> (readable text on white or tint) and a{" "}
          <b>tint</b> (soft backgrounds, hover).
        </p>
        <div className="appr-families">
          {FAMILIES.map((f) => (
            <div key={f.title} className="appr-family">
              <div className="appr-family-head">
                <b>{f.title}</b>
                <small>{f.use}</small>
              </div>
              <div className="appr-strip">
                {f.vars.map((x) => (
                  <button
                    key={x.v}
                    type="button"
                    className="appr-strip-cell"
                    style={{ background: `var(${x.v})` }}
                    onClick={() => copy(hex(x.v))}
                    title={`${x.v} — click to copy`}
                  >
                    <span className={x.role === "Tint" ? "on-light" : "on-dark"}>
                      {x.role}
                      <br />
                      {hex(x.v)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="appr-section">
        <h3>Neutrals</h3>
        <div className="appr-core">
          {NEUTRALS.map((s) => (
            <button key={s.v} type="button" className="appr-swatch" onClick={() => copy(hex(s.v))}>
              <span className="appr-chip appr-chip--edge" style={{ background: `var(${s.v})` }} />
              <span className="appr-meta">
                <b>{s.name}</b>
                <code>{hex(s.v)}</code>
                <small>{s.use}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="appr-section">
        <h3>Buttons</h3>
        <div className="appr-rows">
          <Row label="Primary" note="Main action on a screen — Save, Create, Send">
            <button type="button" className="btn">Save Quote</button>
            <button type="button" className="btn btn-sm">Small</button>
            <button type="button" className="btn" disabled>Disabled</button>
          </Row>
          <Row label="Secondary" note="Edit, Import, Copy, Add Filter">
            <button type="button" className="btn outline">Edit</button>
            <button type="button" className="btn outline btn-sm">Import</button>
          </Row>
          <Row label="Bulk" note="Bulk Edit only">
            <button type="button" className="btn outline bulk">Bulk Edit</button>
          </Row>
          <Row label="Warning" note="Switch off, stop, reversible but serious">
            <button type="button" className="btn outline warn">Switch Off</button>
          </Row>
          <Row label="Danger" note="Delete, remove">
            <button type="button" className="btn danger">Delete</button>
          </Row>
          <Row label="Ghost" note="Cancel, low-emphasis">
            <button type="button" className="btn ghost">Cancel</button>
          </Row>
          <Row label="Status states" note="Toggle buttons when switched on">
            <button type="button" className="btn status">Status</button>
            <button type="button" className="btn status-on is-doing">In progress</button>
            <button type="button" className="btn status-on is-done">Done</button>
            <button type="button" className="btn at-risk-on">At risk</button>
          </Row>
        </div>
      </section>

      <section className="appr-section">
        <h3>Badges, tags &amp; chips</h3>
        <div className="appr-rows">
          <Row label="Badges" note="Record status">
            <span className="badge open">Open</span>
            <span className="badge sent">Sent</span>
            <span className="badge accepted">Accepted</span>
            <span className="badge completed">Completed</span>
            <span className="badge lost">Lost</span>
          </Row>
          <Row label="Tags" note="Inline labels next to a name">
            <span className="tag" style={{ marginLeft: 0 }}>New</span>
            <span className="tag tag-portal-ask">Portal ask</span>
          </Row>
          <Row label="Chips" note="Filters">
            <span className="chips">
              <span className="chip on">All</span>
              <span className="chip">Sea</span>
              <span className="chip">Air</span>
              <span className="chip">Road</span>
            </span>
          </Row>
        </div>
      </section>

      <section className="appr-section">
        <h3>Typography</h3>
        <div className="appr-type">
          <div>
            <h1 style={{ margin: 0 }}>Heading 1</h1>
            <h2 style={{ margin: "6px 0 0" }}>Heading 2</h2>
            <h3 style={{ margin: "6px 0 0" }}>Heading 3</h3>
            <p style={{ margin: "8px 0 0" }}>Body text, 14px / 20px in Ink.</p>
            <p className="muted" style={{ margin: "2px 0 0" }}>Muted text for hints and secondary detail.</p>
          </div>
          <dl className="appr-tokens">
            <dt>Display font</dt>
            <dd>{(t["--display"] || "").split(",")[0] || "—"} (system UI stack)</dd>
            <dt>Body font</dt>
            <dd>{(t["--body"] || "").split(",")[0] || "—"} (system UI stack)</dd>
            <dt>Base size</dt>
            <dd>14px, line height 20px</dd>
            <dt>Headings</dt>
            <dd>Letter spacing −0.02em</dd>
            <dt>Buttons</dt>
            <dd>Display font, bold (700), 0.88rem</dd>
          </dl>
        </div>
      </section>

      <section className="appr-section">
        <h3>Layout</h3>
        <div className="appr-layout">
          <div className="appr-demo-panel">
            <b>Panel</b>
            <small>White on Paper, {t["--radius"] || "16px"} radius, soft shadow</small>
          </div>
          <dl className="appr-tokens">
            <dt>Panel radius</dt>
            <dd>{t["--radius"] || "—"}</dd>
            <dt>Button radius</dt>
            <dd>10px (small: 8px)</dd>
            <dt>Pill radius</dt>
            <dd>999px (badges, tags, chips)</dd>
            <dt>Shadow</dt>
            <dd>
              <code>{t["--shadow"] || "—"}</code>
            </dd>
            <dt>Borders</dt>
            <dd>1px Line ({hex("--line")})</dd>
          </dl>
        </div>
      </section>

      <section className="appr-section">
        <h3>Logo</h3>
        <div className="appr-logos">
          <div className="appr-logo appr-logo--light">
            <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion logo on light" />
          </div>
          <div className="appr-logo appr-logo--dark">
            <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion logo on night" />
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="appr-row">
      <div className="appr-row-label">
        <b>{label}</b>
        <small>{note}</small>
      </div>
      <div className="appr-row-items">{children}</div>
    </div>
  );
}
