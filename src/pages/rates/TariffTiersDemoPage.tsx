// MOCKUP (/rates/tiers-mockup): Platinum / Gold / Silver tier rate sheets
// on Rates & Tariffs — one sheet per tier per trade route, each a full code
// worksheet whose buy rates follow the linked partners' rate structures —
// plus how the Quote Builder would pick a customer's tier. Sample data only,
// nothing is saved.
import { useMemo, useState } from "react";
import { CHARGE_CATALOG, type CatalogItem } from "../../lib/chargeCatalog";
import { CHARGE_CATEGORIES, type QuoteMode } from "../../lib/types";
import { CUSTOMS_VAT_CODE, SERVICE_FEE_CODES } from "../../lib/calc";
import DateInput from "../../components/DateInput";

type Tier = "platinum" | "gold" | "silver";
type Kind = "agent" | "transporter" | "clearing_agent";
type Source = Kind | "manual";

const TIERS: { id: Tier; label: string; colour: string; margin: number; note: string }[] = [
  { id: "platinum", label: "Platinum", colour: "var(--night)", margin: 10, note: "Highest-volume customers" },
  { id: "gold", label: "Gold", colour: "var(--amber)", margin: 15, note: "Regular / consistent volume" },
  { id: "silver", label: "Silver", colour: "var(--muted)", margin: 18, note: "Standard rates — default for every customer" },
];
const tierOf = (id: Tier) => TIERS.find((t) => t.id === id)!;

const MODES: { mode: QuoteMode; label: string }[] = [
  { mode: "Air Freight (AIR)", label: "Air Freight" },
  { mode: "Sea Freight (FCL)", label: "Sea FCL" },
  { mode: "Sea Freight (LCL)", label: "Sea LCL" },
  { mode: "Courier Express (CX)", label: "Courier Express" },
];

// ---- sample partners and their rate structures ("live" partner rates) ----
const PARTNERS: Record<Kind, string[]> = {
  agent: ["Sino Link Logistics (SZX)", "Pacific Bridge Freight (HKG)", "Orient Consol (CAN)"],
  transporter: ["Rand Express Couriers", "Highveld Cartage", "Metro Freight Haulage"],
  clearing_agent: ["ExPac Clearing (in-house)", "Gateway Customs Brokers", "Port Clear SA"],
};
const STRUCTURES: Record<string, string[]> = {
  "Sino Link Logistics (SZX)": ["China → JNB Air (Oct 2026)", "China → DUR Sea (Q4 2026)"],
  "Pacific Bridge Freight (HKG)": ["HKG → JNB Air + DG (Oct 2026)", "HKG → DUR Sea (Q4 2026)"],
  "Orient Consol (CAN)": ["CAN → JNB Air consol (Sep 2026)", "CAN → DUR Sea consol"],
  "Rand Express Couriers": ["Gauteng delivery 2026"],
  "Highveld Cartage": ["ORTIA → Gauteng cartage"],
  "Metro Freight Haulage": ["DBN port → Gauteng"],
  "ExPac Clearing (in-house)": ["Standard clearing 2026"],
  "Gateway Customs Brokers": ["Clearing tariff 2026"],
  "Port Clear SA": ["Port clearing tariff"],
};
// Each structure prices slightly differently.
const STRUCTURE_FACTOR: Record<string, number> = Object.fromEntries(
  Object.values(STRUCTURES)
    .flat()
    .map((s, i) => [s, 1 + ((i * 7) % 5) * 0.03]),
);

const BASE_BUY: Record<string, number> = {
  "AF-02": 29, "OF-01": 1450, "OF-02": 65, "OF-06": 58,
  "OR-01": 45, "OR-02": 47.5, "OR-03": 25, "OR-04": 30, "OR-05": 85,
  "OR-06": 120, "OR-07": 40, "AF-03": 650, "TR-01": 1150, "TR-02": 180,
  "OF-03": 950, "OF-04": 420, "OF-05": 2850, "OF-07": 380,
};
const AF01_BREAKS = [
  { label: "0-45KG", max: 45, rate: 7.32 },
  { label: "0-100KG", max: 100, rate: 6.98 },
  { label: "0-300KG", max: 300, rate: 6.75 },
  { label: "0-500KG", max: 500, rate: 6.59 },
  { label: "0-1000KG", max: 1000, rate: 6.43 },
];
const SELL_ONLY_SELL: Record<string, number> = {
  "FW-01": 45, "IN-01": 35, "DIS-01": 350, "CU-05": 1250, "CU-02": 0, "CU-03": 0,
};

const CATEGORY_SOURCE: Record<string, Kind> = {
  "International Freight Charges": "agent",
  "Ex-Works Charges": "agent",
  "Destination Handling and Delivery Charges": "transporter",
  "Customs Clearance, VAT and Duty Charges": "clearing_agent",
};
const SOURCE_LABEL: Record<Source, string> = {
  agent: "Agent",
  transporter: "Transporter",
  clearing_agent: "Clearing agent",
  manual: "Manual",
};

// ---- trade routes (each has its own sheet per tier) ----
interface Route {
  id: string;
  mode: QuoteMode;
  name: string;
  origin: string;
  destination: string;
  agent: string;
}
const ROUTES: Route[] = [
  { id: "air-cn", mode: "Air Freight (AIR)", name: "China → JNB", origin: "China (SZX, CAN, PEK, PVG)", destination: "JNB / DUR / CPT", agent: "Sino Link Logistics (SZX)" },
  { id: "air-hk", mode: "Air Freight (AIR)", name: "Hong Kong → JNB", origin: "Hong Kong (HKG)", destination: "JNB", agent: "Pacific Bridge Freight (HKG)" },
  { id: "fcl-cn", mode: "Sea Freight (FCL)", name: "China → DUR", origin: "China (SHA, NGB, SZX)", destination: "DUR → JNB", agent: "Orient Consol (CAN)" },
  { id: "lcl-cn", mode: "Sea Freight (LCL)", name: "China → DUR (LCL)", origin: "China (SZX, NGB)", destination: "DUR → JNB", agent: "Sino Link Logistics (SZX)" },
  { id: "lcl-hk", mode: "Sea Freight (LCL)", name: "Hong Kong → DUR (LCL)", origin: "Hong Kong (HKG)", destination: "DUR → JNB", agent: "Pacific Bridge Freight (HKG)" },
  { id: "cx-cn", mode: "Courier Express (CX)", name: "China → JNB (express)", origin: "China / Hong Kong", destination: "JNB", agent: "Pacific Bridge Freight (HKG)" },
];

interface Line {
  source: Source;
  manualBuy: number;
  margin: number | null; // null = use the sheet's tier margin
  sell: number; // sell-only codes
}
interface Sheet {
  origin: string;
  destination: string;
  valid_from: string;
  valid_until: string;
  margin: number;
  agent: string;
  agent_structure: string;
  transporter: string;
  transporter_structure: string;
  clearing_agent: string;
  clearing_agent_structure: string;
  lines: Record<string, Line>;
}

const isSellOnly = (code: string) =>
  SERVICE_FEE_CODES.includes(code) || code === CUSTOMS_VAT_CODE || code === "CU-03";
const isSea = (mode: QuoteMode) => mode.startsWith("Sea");
const structFor = (partner: string, mode: QuoteMode) =>
  STRUCTURES[partner][isSea(mode) && STRUCTURES[partner].length > 1 ? 1 : 0];

function newSheet(tier: Tier, route: Route): Sheet {
  const lines: Record<string, Line> = {};
  for (const c of CHARGE_CATALOG) {
    if (c.modes && !c.modes.includes(route.mode)) continue;
    lines[c.code] = {
      source: isSellOnly(c.code) ? "manual" : CATEGORY_SOURCE[c.category],
      manualBuy: BASE_BUY[c.code] ?? 0,
      margin: null,
      sell: SELL_ONLY_SELL[c.code] ?? 0,
    };
  }
  const transporter = isSea(route.mode) ? "Metro Freight Haulage" : "Rand Express Couriers";
  // The same partners can sit on every tier — only the margin differs by default.
  return {
    origin: route.origin,
    destination: route.destination,
    valid_from: "2026-10-01",
    valid_until: "2026-12-31",
    margin: tierOf(tier).margin,
    agent: route.agent,
    agent_structure: structFor(route.agent, route.mode),
    transporter,
    transporter_structure: STRUCTURES[transporter][0],
    clearing_agent: "ExPac Clearing (in-house)",
    clearing_agent_structure: STRUCTURES["ExPac Clearing (in-house)"][0],
    lines,
  };
}

type Sheets = Record<string, Sheet>; // `${tier}|${routeId}`
function buildAll(): Sheets {
  const out: Sheets = {};
  for (const t of TIERS) for (const r of ROUTES) out[`${t.id}|${r.id}`] = newSheet(t.id, r);
  return out;
}

const fmt = (n: number) =>
  n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function TierDot({ tier }: { tier: Tier }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 999,
        background: tierOf(tier).colour,
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

const CUSTOMERS: { name: string; tier: Tier }[] = [
  { name: "Karoo Outdoor (Pty) Ltd", tier: "platinum" },
  { name: "Blue Crane Retail", tier: "gold" },
  { name: "Acme Imports CC", tier: "silver" },
  { name: "New customer", tier: "silver" },
];

export default function TariffTiersDemoPage() {
  const [all, setAll] = useState(buildAll);
  const [partnerBump, setPartnerBump] = useState(0); // simulated partner rate change, %
  const [tier, setTier] = useState<Tier>("silver");
  const [mode, setMode] = useState<QuoteMode>("Air Freight (AIR)");
  const routes = ROUTES.filter((r) => r.mode === mode);
  const [routeId, setRouteId] = useState(routes[0].id);
  const route = routes.find((r) => r.id === routeId) ?? routes[0];
  const sheet = all[`${tier}|${route.id}`];

  // Live partner buy rate for a code on a structure.
  const partnerBuy = (structure: string, code: string) =>
    (BASE_BUY[code] ?? 0) * (STRUCTURE_FACTOR[structure] ?? 1) * (1 + partnerBump / 100);
  const breaksFor = (structure: string) =>
    AF01_BREAKS.map((b) => ({
      ...b,
      rate: b.rate * (STRUCTURE_FACTOR[structure] ?? 1) * (1 + partnerBump / 100),
    }));

  const buyOf = (s: Sheet, code: string, l: Line) =>
    l.source === "manual" ? l.manualBuy : partnerBuy(s[`${l.source}_structure`], code);
  const marginOf = (s: Sheet, l: Line) => l.margin ?? s.margin;
  const sellOf = (s: Sheet, c: CatalogItem, l: Line, buy?: number) =>
    isSellOnly(c.code) ? l.sell : (buy ?? buyOf(s, c.code, l)) * (1 + marginOf(s, l) / 100);

  const patch = (p: Partial<Sheet>) =>
    setAll((a) => ({ ...a, [`${tier}|${route.id}`]: { ...sheet, ...p } }));
  const patchLine = (code: string, p: Partial<Line>) =>
    patch({ lines: { ...sheet.lines, [code]: { ...sheet.lines[code], ...p } } });

  const pickMode = (m: QuoteMode) => {
    setMode(m);
    setRouteId(ROUTES.find((r) => r.mode === m)!.id);
  };

  const partnerField = (kind: Kind, label: string) => {
    const structKey = `${kind}_structure` as const;
    return (
      <div className="field">
        <label>{label}</label>
        <select
          value={sheet[kind]}
          onChange={(e) =>
            patch({ [kind]: e.target.value, [structKey]: structFor(e.target.value, mode) })
          }
        >
          {PARTNERS[kind].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          style={{ marginTop: 6 }}
          value={sheet[structKey]}
          onChange={(e) => patch({ [structKey]: e.target.value })}
        >
          {STRUCTURES[sheet[kind]].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="hint">Linked buy rates follow this rate structure.</span>
      </div>
    );
  };

  // ---------------- Quote Builder preview ----------------
  const [qbCustomer, setQbCustomer] = useState(CUSTOMERS[2].name);
  const [qbMode, setQbMode] = useState<QuoteMode>("Air Freight (AIR)");
  const qbRoutes = ROUTES.filter((r) => r.mode === qbMode);
  const [qbRouteId, setQbRouteId] = useState(qbRoutes[0].id);
  const qbRoute = qbRoutes.find((r) => r.id === qbRouteId) ?? qbRoutes[0];
  const [qbTier, setQbTier] = useState<Tier>("silver");
  const [qbKg, setQbKg] = useState(35);
  const [qbOverride, setQbOverride] = useState<Partial<Record<Kind, string>>>({});
  const [loaded, setLoaded] = useState(false);
  const qbSheet = all[`${qbTier}|${qbRoute.id}`];
  // Partners picked on the quote override the tier sheet's (same tier margin).
  const qbEff: Sheet = useMemo(() => {
    const s = { ...qbSheet };
    for (const k of ["agent", "transporter", "clearing_agent"] as Kind[]) {
      const p = qbOverride[k];
      if (p) {
        s[k] = p;
        s[`${k}_structure`] = structFor(p, qbMode);
      }
    }
    return s;
  }, [qbSheet, qbOverride, qbMode]);
  const qbBreak =
    breaksFor(qbEff.agent_structure).find((b) => qbKg <= b.max) ??
    breaksFor(qbEff.agent_structure).at(-1)!;

  const sheetGroups = CHARGE_CATEGORIES.map((category) => ({
    category,
    items: CHARGE_CATALOG.filter(
      (c) => c.category === category && (!c.modes || c.modes.includes(mode)),
    ),
  }));

  return (
    <div>
      <p className="hint" style={{ margin: "0 0 4px" }}>
        MOCKUP · Rates &amp; Tariff — sample data, nothing is saved
      </p>
      <h1 style={{ margin: "0 0 16px" }}>Tier Rate Sheets</h1>

      {/* ---------------- 1. Rates & Tariffs → tier sheet editor ---------------- */}
      <div className="panel">
        <div className="rs-tabs" role="tablist">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rs-tab${tier === t.id ? " on" : ""}`}
              onClick={() => setTier(t.id)}
              title={t.note}
            >
              <TierDot tier={t.id} />
              {t.label} · {t.margin}%
            </button>
          ))}
        </div>
        <div className="rs-tabs" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              className={`rs-tab${mode === m.mode ? " on" : ""}`}
              onClick={() => pickMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid4" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Trade route</label>
            <select value={route.id} onChange={(e) => setRouteId(e.target.value)}>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="hint">Each trade route has its own sheet on every tier.</span>
          </div>
          <div className="field">
            <label>Tier margin (%)</label>
            <input
              type="number"
              step="1"
              value={sheet.margin}
              onChange={(e) => patch({ margin: Number(e.target.value) })}
            />
            <span className="hint">
              Default {tierOf(tier).margin}% on every buy price — {tierOf(tier).note.toLowerCase()}.
            </span>
          </div>
          <div className="field">
            <label>Valid from</label>
            <DateInput value={sheet.valid_from} onChange={(v) => patch({ valid_from: v })} />
          </div>
          <div className="field">
            <label>Valid until</label>
            <DateInput value={sheet.valid_until} onChange={(v) => patch({ valid_until: v })} />
          </div>
          <div className="field">
            <label>Origin</label>
            <input value={sheet.origin} onChange={(e) => patch({ origin: e.target.value })} />
          </div>
          <div className="field">
            <label>Destination</label>
            <input
              value={sheet.destination}
              onChange={(e) => patch({ destination: e.target.value })}
            />
          </div>
          <div className="field" style={{ alignSelf: "end" }}>
            <button type="button" className="btn outline" disabled>
              + New trade route
            </button>
          </div>
        </div>

        <h3 style={{ margin: "4px 0 8px" }}>LINKED PARTNERS</h3>
        <div className="grid3" style={{ marginBottom: 10 }}>
          {partnerField("agent", "Agent")}
          {partnerField("transporter", "Transporter")}
          {partnerField("clearing_agent", "Clearing Agent")}
        </div>
        <p className="hint" style={{ marginBottom: 18 }}>
          Demo: when a partner changes their rates, every tier sheet linked to them updates.{" "}
          <button
            type="button"
            className="btn small outline"
            onClick={() => setPartnerBump((b) => (b ? 0 : 5))}
          >
            {partnerBump ? "Undo partner rate change" : "Simulate partners raising rates 5%"}
          </button>
        </p>

        {sheetGroups.map((g) => (
          <div className="charge-group" key={g.category}>
            <div className="charge-group-head">
              <h3>{g.category.toUpperCase()}</h3>
            </div>
            <div className="table-wrap">
              <table className="charge-table">
                <thead>
                  <tr>
                    <th className="c-code">Code</th>
                    <th>Description</th>
                    <th className="c-cur">Cur</th>
                    <th className="c-unit">Unit</th>
                    <th>Buy from</th>
                    <th className="num">Buy</th>
                    <th className="num">Margin (%)</th>
                    <th className="num">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.flatMap((c) => {
                    const l = sheet.lines[c.code];
                    const sellOnly = isSellOnly(c.code);
                    const linked = !sellOnly && l.source !== "manual";
                    const partner = linked ? sheet[l.source as Kind] : "";
                    const hasBreaks = c.code === "AF-01" && l.source === "agent";
                    const rows = [
                      <tr key={c.code}>
                        <td className="c-code">{c.code}</td>
                        <td>{c.description}</td>
                        <td className="c-cur">{c.cur}</td>
                        <td className="c-unit">{c.unit || "—"}</td>
                        <td>
                          {sellOnly ? (
                            <span className="hint">Sell only</span>
                          ) : (
                            <select
                              value={l.source}
                              onChange={(e) =>
                                patchLine(c.code, { source: e.target.value as Source })
                              }
                              title={partner || undefined}
                            >
                              {(["agent", "transporter", "clearing_agent", "manual"] as Source[]).map(
                                (s) => (
                                  <option key={s} value={s}>
                                    {SOURCE_LABEL[s]}
                                  </option>
                                ),
                              )}
                            </select>
                          )}
                        </td>
                        <td className="num">
                          {sellOnly ? (
                            "—"
                          ) : hasBreaks ? (
                            <span className="hint">By weight ↓</span>
                          ) : linked ? (
                            <input
                              type="number"
                              value={buyOf(sheet, c.code, l).toFixed(2)}
                              readOnly
                              title={`Live from ${partner}`}
                            />
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={l.manualBuy}
                              onChange={(e) =>
                                patchLine(c.code, { manualBuy: Number(e.target.value) })
                              }
                            />
                          )}
                        </td>
                        <td className="num">
                          {sellOnly ? (
                            "—"
                          ) : (
                            <input
                              type="number"
                              step="1"
                              value={marginOf(sheet, l)}
                              title={l.margin == null ? "Tier margin" : "Overridden on this line"}
                              onChange={(e) =>
                                patchLine(c.code, { margin: Number(e.target.value) })
                              }
                            />
                          )}
                        </td>
                        <td className="num">
                          {sellOnly ? (
                            <input
                              type="number"
                              step="0.01"
                              value={l.sell}
                              onChange={(e) => patchLine(c.code, { sell: Number(e.target.value) })}
                            />
                          ) : hasBreaks ? (
                            ""
                          ) : (
                            fmt(sellOf(sheet, c, l))
                          )}
                        </td>
                      </tr>,
                    ];
                    if (hasBreaks)
                      for (const b of breaksFor(sheet.agent_structure))
                        rows.push(
                          <tr key={`${c.code}-${b.label}`}>
                            <td />
                            <td className="hint">↳ {b.label}</td>
                            <td className="c-cur">{c.cur}</td>
                            <td className="c-unit">KGS</td>
                            <td className="hint">{sheet.agent}</td>
                            <td className="num">{fmt(b.rate)}</td>
                            <td className="num">{marginOf(sheet, l)}</td>
                            <td className="num">{fmt(b.rate * (1 + marginOf(sheet, l) / 100))}</td>
                          </tr>,
                        );
                    return rows;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="hint">
          Lines bought from a partner are read-only and follow that partner's rate structure live.
          Set a line to Manual to type your own buy. Margin uses the tier margin unless you change
          it on a line.
        </p>
      </div>

      {/* ---------------- 2. Quote Builder → pick a tier ---------------- */}
      <p className="hint" style={{ margin: "24px 0 4px" }}>MOCKUP · Quote Builder</p>
      <h2 style={{ margin: "0 0 12px" }}>New Quotation — rate tier</h2>
      <div className="panel">
        <div className="grid4">
          <div className="field">
            <label>Customer</label>
            <select
              value={qbCustomer}
              onChange={(e) => {
                setQbCustomer(e.target.value);
                setQbTier(CUSTOMERS.find((c) => c.name === e.target.value)!.tier);
              }}
            >
              {CUSTOMERS.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({tierOf(c.tier).label})
                </option>
              ))}
            </select>
            <span className="hint">The customer's tier is set on their record — Silver by default.</span>
          </div>
          <div className="field">
            <label>Mode</label>
            <select
              value={qbMode}
              onChange={(e) => {
                const m = e.target.value as QuoteMode;
                setQbMode(m);
                setQbRouteId(ROUTES.find((r) => r.mode === m)!.id);
              }}
            >
              {MODES.map((m) => (
                <option key={m.mode} value={m.mode}>
                  {m.mode}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Trade route</label>
            <select value={qbRoute.id} onChange={(e) => setQbRouteId(e.target.value)}>
              {qbRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Rate tier</label>
            <select value={qbTier} onChange={(e) => setQbTier(e.target.value as Tier)}>
              {TIERS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.margin}%)
                </option>
              ))}
            </select>
            <span className="hint">From the customer — change it for this quote if needed.</span>
          </div>
          <div className="field">
            <label>Chargeable weight (kg)</label>
            <input
              type="number"
              step="0.01"
              value={qbKg}
              onChange={(e) => setQbKg(Number(e.target.value))}
            />
            <span className="hint">From the packing list on the real Quote Builder.</span>
          </div>
          {(["agent", "clearing_agent", "transporter"] as Kind[]).map((k) => (
            <div className="field" key={k}>
              <label>
                {k === "agent" ? "Agent" : k === "transporter" ? "Transporter" : "Clearing Agent"}{" "}
                (internal only)
              </label>
              <select
                value={qbEff[k]}
                onChange={(e) =>
                  setQbOverride((o) => ({
                    ...o,
                    [k]: e.target.value === qbSheet[k] ? undefined : e.target.value,
                  }))
                }
              >
                {PARTNERS[k].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <span className="hint">
                {qbOverride[k] ? "Changed on this quote." : "From the tier sheet — change if needed."}
              </span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setLoaded(true)}>
            Load tier rates
          </button>
        </div>

        {loaded && (
          <div style={{ marginTop: 18 }}>
            <p className="hint" style={{ marginBottom: 8 }}>
              <TierDot tier={qbTier} />
              {tierOf(qbTier).label} · {qbRoute.name} · {qbMode} — every code below is now an
              ordinary quote line you can edit.
            </p>
            {CHARGE_CATEGORIES.map((category) => {
              const items = CHARGE_CATALOG.filter(
                (c) => c.category === category && (!c.modes || c.modes.includes(qbMode)),
              );
              return (
                <div className="charge-group" key={category}>
                  <div className="charge-group-head">
                    <h3>{category.toUpperCase()}</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="charge-table">
                      <thead>
                        <tr>
                          <th className="c-code">Code</th>
                          <th>Description</th>
                          <th className="c-cur">Cur</th>
                          <th className="c-unit">Unit</th>
                          <th className="num">Qty</th>
                          <th className="num">Buy</th>
                          <th className="num">Margin (%)</th>
                          <th className="num">Sell</th>
                          <th className="num">Total Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((c) => {
                          const l = qbEff.lines[c.code];
                          const so = isSellOnly(c.code);
                          const isAf = c.code === "AF-01" && l.source === "agent";
                          const buy = isAf ? qbBreak.rate : buyOf(qbEff, c.code, l);
                          const qty = isAf ? qbKg : 1;
                          const sell = sellOf(qbEff, c, l, buy);
                          return (
                            <tr key={c.code}>
                              <td className="c-code">{c.code}</td>
                              <td>
                                {c.description}
                                {isAf && <span className="hint"> · {qbBreak.label} break</span>}
                              </td>
                              <td className="c-cur">{c.cur}</td>
                              <td className="c-unit">{c.unit || "—"}</td>
                              <td className="num">{fmt(qty)}</td>
                              <td className="num">{so ? "—" : fmt(buy)}</td>
                              <td className="num">{so ? "—" : marginOf(qbEff, l)}</td>
                              <td className="num">{fmt(sell)}</td>
                              <td className="num">{fmt(sell * qty)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
