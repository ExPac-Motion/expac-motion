import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNote, Loading, PageHeader, StatusBadge } from "../components/common";
import QuoteDetailModal from "./QuoteDetailModal";
import { useJobs, useQuotes } from "../lib/hooks";
import { chargeTotals, fxOf } from "../lib/calc";
import { formatDate, money, portCode } from "../lib/format";
import {
  isShipmentComplete,
  MILESTONES,
  STATUS_LABEL,
  STATUS_ORDER,
  type Job,
  type Milestone,
} from "../lib/types";

type ModeKey = "Sea" | "Air" | "Road" | "Courier";
type ModeFilter = "All" | ModeKey;

const MODE_META: { key: ModeKey; label: string; color: string }[] = [
  { key: "Sea", label: "Sea Freight", color: "#7ea63c" },
  { key: "Air", label: "Air Freight", color: "#3f7d8c" },
  { key: "Road", label: "Road Freight", color: "#c98a2e" },
  { key: "Courier", label: "Courier Express", color: "#7d6a9c" },
];

function modeBucket(mode: string | null | undefined): ModeKey | "Other" {
  const m = (mode ?? "").toLowerCase();
  if (m.startsWith("sea")) return "Sea";
  if (m.startsWith("air")) return "Air";
  if (m.startsWith("road")) return "Road";
  if (m.startsWith("courier")) return "Courier";
  return "Other";
}

function milestoneTag(m: Milestone): string {
  if (m === "Delivered") return "ms-tag";
  if (m === "In Transit") return "ms-tag transit";
  if (m === "Customs") return "ms-tag customs";
  return "ms-tag";
}

/* ---------------- icons (inherit currentColor) ---------------- */
const Icon = {
  jobs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  ),
  approval: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6a1 1 0 011 1v1h1a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h1V4a1 1 0 011-1z" />
      <path d="M9 13l2 2 4-4" />
    </svg>
  ),
  ship: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 14l1.6 5.2a1 1 0 00.96.8h12.88a1 1 0 00.96-.8L21 14" />
      <path d="M5 14V8a2 2 0 012-2h10a2 2 0 012 2v6" />
      <path d="M12 3v3M3 14c2 1.5 3.5 1.5 4.5 0M12 14c1 1.5 2.5 1.5 4.5 0" />
    </svg>
  ),
  plane: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.5 13.5L21 3M21 3l-6.5 18-4-8-8-4L21 3z" />
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" />
      <circle cx="7.5" cy="17.5" r="1.8" />
      <circle cx="17.5" cy="17.5" r="1.8" />
    </svg>
  ),
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("All");

  // Grow the bars from zero on first paint.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, []);

  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const jobs = useMemo(() => jobsQ.data ?? [], [jobsQ.data]);

  const activeJobs = useMemo(
    () => jobs.filter((j) => !isShipmentComplete(j)),
    [jobs],
  );

  const modeCounts = useMemo(() => {
    const c: Record<ModeKey, number> = { Sea: 0, Air: 0, Road: 0, Courier: 0 };
    activeJobs.forEach((j) => {
      const b = modeBucket(j.mode);
      if (b !== "Other") c[b] += 1;
    });
    return c;
  }, [activeJobs]);

  const dueForApproval = useMemo(
    () => quotes.filter((q) => q.status === "sent"),
    [quotes],
  );
  const dueValue = useMemo(
    () =>
      dueForApproval.reduce(
        (s, q) => s + chargeTotals(q.quote_lines, fxOf(q)).sell,
        0,
      ),
    [dueForApproval],
  );

  const funnel = useMemo(() => {
    const counts = MILESTONES.map(
      (m) => jobs.filter((j) => j.milestone === m).length,
    );
    return { counts, max: Math.max(1, ...counts) };
  }, [jobs]);

  const pipeline = useMemo(() => {
    const rows = STATUS_ORDER.map((st) => {
      const qs = quotes.filter((q) => q.status === st);
      const val = qs.reduce(
        (s, q) => s + chargeTotals(q.quote_lines, fxOf(q)).sell,
        0,
      );
      return { st, count: qs.length, val };
    });
    return { rows, max: Math.max(1, ...rows.map((r) => r.val)) };
  }, [quotes]);

  const portfolio = useMemo(() => {
    const withT = quotes.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
    const openValue = quotes
      .map((q, i) => ({ q, t: withT[i] }))
      .filter((x) => x.q.status !== "accepted")
      .reduce((s, x) => s + x.t.sell, 0);
    const avgMargin =
      withT.length > 0
        ? withT.reduce((s, t) => s + t.margin, 0) / withT.length
        : 0;
    return { openValue, avgMargin, total: quotes.length };
  }, [quotes]);

  const shownJobs = useMemo(
    () =>
      activeJobs.filter(
        (j) => modeFilter === "All" || modeBucket(j.mode) === modeFilter,
      ),
    [activeJobs, modeFilter],
  );

  const recent = quotes.slice(0, 5);
  const loading = quotesQ.isLoading || jobsQ.isLoading;
  const errored = quotesQ.isError || jobsQ.isError;

  function toggleMode(k: ModeKey) {
    setModeFilter((cur) => (cur === k ? "All" : k));
  }

  return (
    <>
      <PageHeader
        eyebrow="Excellence in Motion"
        title="Dashboard"
        actions={
          <button className="btn" onClick={() => navigate("/quotes/new")}>
            New Quotation
          </button>
        }
      />

      {loading ? (
        <div className="panel">
          <Loading label="Loading your data…" />
        </div>
      ) : errored ? (
        <div className="panel">
          <ErrorNote error={quotesQ.error ?? jobsQ.error} />
        </div>
      ) : (
        <>
          {/* ---- KPI widgets ---- */}
          <div className="dash-kpis">
            <Kpi
              icon={Icon.jobs}
              label="Total Active Shipments"
              value={activeJobs.length}
              selected={modeFilter === "All"}
              onClick={() => setModeFilter("All")}
              foot={<span>{jobs.length} all-time</span>}
            />
            <Kpi
              icon={Icon.approval}
              label="Due for Approval Quotations"
              value={dueForApproval.length}
              onClick={() => navigate("/quotes?status=sent")}
              foot={<span>{money(dueValue)} in play</span>}
            />
            {MODE_META.slice(0, 3).map((m) => (
              <Kpi
                key={m.key}
                icon={
                  m.key === "Sea"
                    ? Icon.ship
                    : m.key === "Air"
                      ? Icon.plane
                      : Icon.truck
                }
                label={`Total ${m.label} Shipments`}
                value={modeCounts[m.key]}
                selected={modeFilter === m.key}
                onClick={() => toggleMode(m.key)}
                foot={
                  <>
                    <span className="kpi-share">
                      <span
                        style={{
                          width: grown
                            ? `${
                                activeJobs.length
                                  ? (modeCounts[m.key] / activeJobs.length) * 100
                                  : 0
                              }%`
                            : "0%",
                          background: m.color,
                        }}
                      />
                    </span>
                    <span>of {activeJobs.length}</span>
                  </>
                }
              />
            ))}
          </div>

          {/* ---- Mode split + operational funnel ---- */}
          <div className="dash-2">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Active Shipments by Mode</h2>
                  <p>Click a segment to filter the list below</p>
                </div>
              </div>
              <ModeDonut
                counts={modeCounts}
                total={activeJobs.length}
                selected={modeFilter}
                onPick={toggleMode}
              />
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h2>Operational Funnel</h2>
                  <p>Every shipment by milestone, all-time</p>
                </div>
              </div>
              <div className="funnel">
                {MILESTONES.map((m, i) => (
                  <div className="funnel-step" key={m}>
                    <div className="nm">{m}</div>
                    <div className="track">
                      <div
                        className="fill"
                        style={{
                          width: grown
                            ? `${(funnel.counts[i] / funnel.max) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <div className="ct">{funnel.counts[i]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ---- Quotation pipeline ---- */}
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Quotation Pipeline</h2>
                <p>Value by stage, from your saved quotes</p>
              </div>
              <div className="mini-stats">
                <div>
                  <div className="k">Open quote value</div>
                  <div className="v">{money(portfolio.openValue)}</div>
                </div>
                <div>
                  <div className="k">Avg margin</div>
                  <div className="v">{portfolio.avgMargin.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="k">Total quotes</div>
                  <div className="v">{portfolio.total}</div>
                </div>
              </div>
            </div>
            <div className="pipe">
              {pipeline.rows.map((p) => {
                const accent = p.st === "sent";
                return (
                  <button
                    key={p.st}
                    className={`pipe-row${accent ? " accent" : ""}`}
                    onClick={() => navigate(`/quotes?status=${p.st}`)}
                  >
                    <span className="nm">
                      {accent && (
                        <span
                          className="ms-tag"
                          style={{ background: "#eef4e3" }}
                        >
                          due
                        </span>
                      )}
                      {STATUS_LABEL[p.st]}
                    </span>
                    <span className="track">
                      <span
                        className="fill"
                        style={{
                          width: grown
                            ? `${(p.val / pipeline.max) * 100}%`
                            : "0%",
                        }}
                      />
                    </span>
                    <span>
                      <span className="amt">{money(p.val)}</span>
                      <span className="cnt">
                        {" "}
                        · {p.count} quote{p.count === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- Active jobs list (filtered by the mode widgets) ---- */}
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Active Shipments</h2>
                <p>
                  {shownJobs.length} shown
                  {modeFilter !== "All" ? ` · ${modeFilter} only` : ""}
                </p>
              </div>
              <div className="chips">
                {(["All", "Sea", "Air", "Road", "Courier"] as ModeFilter[]).map(
                  (k) => (
                    <button
                      key={k}
                      className={`chip${modeFilter === k ? " on" : ""}`}
                      onClick={() => setModeFilter(k)}
                    >
                      {k}
                    </button>
                  ),
                )}
                <button
                  className="chip"
                  onClick={() => navigate("/jobs")}
                  title="Open the Active Shipments board"
                >
                  Board →
                </button>
              </div>
            </div>
            {shownJobs.length === 0 ? (
              <div className="empty">
                {activeJobs.length === 0
                  ? "No active shipments. Accept a quotation to create one."
                  : `No active ${modeFilter} shipments.`}
              </div>
            ) : (
              <div className="table-wrap">
                <table className="job-mini">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Customer</th>
                      <th>Trade lane</th>
                      <th>Mode</th>
                      <th>Milestone</th>
                      <th>ETA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownJobs.slice(0, 8).map((j: Job) => (
                      <tr
                        key={j.id}
                        className="clickable"
                        onClick={() => navigate("/jobs")}
                      >
                        <td>
                          <strong>{j.reference}</strong>
                        </td>
                        <td>{j.client?.company ?? "—"}</td>
                        <td className="nowrap">
                          {portCode(j.origin)} → {portCode(j.destination)}
                        </td>
                        <td>
                          <span className="mode-tag">{j.mode}</span>
                        </td>
                        <td>
                          <span className={milestoneTag(j.milestone)}>
                            {j.milestone}
                          </span>
                        </td>
                        <td>{formatDate(j.eta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ---- Recent quotations ---- */}
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Recent Quotations</h2>
                <p>Your five most recently created quotes</p>
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="empty">
                No quotations yet. Click "New Quotation" to create your first one.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Customer</th>
                      <th>Shipper</th>
                      <th>Trade lane</th>
                      <th>Mode</th>
                      <th>Total Cost</th>
                      <th>Total Value</th>
                      <th>Margin</th>
                      <th>Total Profit</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((q) => {
                      const t = chargeTotals(q.quote_lines, fxOf(q));
                      return (
                        <tr
                          key={q.id}
                          className="clickable"
                          onClick={() => setOpenId(q.id)}
                        >
                          <td>
                            <strong>{q.reference}</strong>
                          </td>
                          <td>{q.client?.company ?? "—"}</td>
                          <td>{q.supplier?.company ?? "—"}</td>
                          <td className="nowrap">
                            {portCode(q.origin)} → {portCode(q.destination)}
                          </td>
                          <td>{q.mode}</td>
                          <td>{money(t.cost)}</td>
                          <td>{money(t.sell)}</td>
                          <td>{t.margin.toFixed(1)}%</td>
                          <td>{money(t.gp)}</td>
                          <td>
                            <StatusBadge status={q.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {openId && (
        <QuoteDetailModal quoteId={openId} onClose={() => setOpenId(null)} />
      )}
    </>
  );
}

/* ---------------- widgets ---------------- */

function Kpi({
  icon,
  label,
  value,
  foot,
  onClick,
  selected,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  foot: ReactNode;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      className={`kpi${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </button>
  );
}

function ModeDonut({
  counts,
  total,
  selected,
  onPick,
}: {
  counts: Record<ModeKey, number>;
  total: number;
  selected: ModeFilter;
  onPick: (k: ModeKey) => void;
}) {
  const R = 62;
  const SW = 22;
  const C = 2 * Math.PI * R;
  const gap = total > 1 ? 3 : 0;

  let acc = 0;
  const segs = MODE_META.map((m) => {
    const v = counts[m.key];
    const frac = total > 0 ? v / total : 0;
    const len = Math.max(0, frac * C - gap);
    const seg = { ...m, v, offset: acc, len };
    acc += frac * C;
    return seg;
  });

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 160 160" width="160" height="160">
          <circle
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke="#f0efe9"
            strokeWidth={SW}
          />
          {total > 0 &&
            segs
              .filter((s) => s.v > 0)
              .map((s) => (
                <circle
                  key={s.key}
                  className="donut-seg"
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={SW}
                  strokeDasharray={`${s.len} ${C - s.len}`}
                  strokeDashoffset={-s.offset}
                  strokeLinecap={gap ? "round" : "butt"}
                  onClick={() => onPick(s.key)}
                >
                  <title>
                    {s.label}: {s.v}
                  </title>
                </circle>
              ))}
        </svg>
        <div className="donut-center">
          <div>
            <b>{total}</b>
            <span>ACTIVE SHIPMENTS</span>
          </div>
        </div>
      </div>
      <div className="donut-legend">
        {MODE_META.map((m) => (
          <button
            key={m.key}
            className={`${counts[m.key] === 0 ? "zero" : ""}${
              selected === m.key ? " selected" : ""
            }`}
            onClick={() => onPick(m.key)}
          >
            <span className="sw" style={{ background: m.color }} />
            {m.label}
            <span className="ct">{counts[m.key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
