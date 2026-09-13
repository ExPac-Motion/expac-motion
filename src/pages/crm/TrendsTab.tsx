import { useMemo, useState, type Key } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Modal from "../../components/Modal";
import { ErrorNote, Loading } from "../../components/common";
import {
  useCompanySettings,
  useLeads,
  useOpportunities,
  useQuotes,
} from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import { formatDate, money } from "../../lib/format";
import {
  WON_QUOTE_STATUSES,
  type Lead,
  type Opportunity,
  type Quote,
} from "../../lib/types";
import QuoteDetailModal from "../QuoteDetailModal";

type Preset = "this_year" | "last_6" | "last_12" | "custom";

interface MonthBucket {
  month: string; // "YYYY-MM"
  label: string; // "Jan '26"
  salesTotal: number;
  salesQuotes: Quote[];
  revenueTotal: number;
  revenueQuotes: Quote[];
  /** Completed opportunities with no linked quote -- real historical sales
   *  (pre-dating the quoting system) with no cost data behind them. */
  revenueOpportunities: Opportunity[];
  costTotal: number;
  /** Only the slice of revenueTotal that has real cost data (quote-based) --
   *  the denominator for costRatio, so cost-less historical opportunity
   *  revenue doesn't silently read as a 100% margin. */
  costTrackedRevenue: number;
  costRatio: number | null;
  leadsCreated: number;
  createdLeads: Lead[];
  leadsConverted: number;
  convertedLeads: Lead[];
}

type DrillKind = "sales" | "revenue" | "ratio" | "leadsCreated" | "leadsConverted";

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-ZA", {
    month: "short",
    year: "2-digit",
  });
}
function buildMonthRange(fromKey: string, toKey: string): string[] {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  // Guard against an inverted/absurd custom range instead of looping forever.
  for (let i = 0; i < 240 && (y < ty || (y === ty && m <= tm)); i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const COLORS = {
  sales: "#8cbc43",
  revenue: "#4a6fa5",
  ratio: "#d98e04",
  target: "#d9534f",
  leadsCreated: "#8e7cc3",
  leadsConverted: "#2e7d32",
};

export default function TrendsTab() {
  const navigate = useNavigate();
  const quotesQ = useQuotes();
  const leadsQ = useLeads();
  const oppsQ = useOpportunities();
  const settingsQ = useCompanySettings();

  const now = useMemo(() => new Date(), []);
  const nowKey = monthKeyOf(now);
  const [preset, setPreset] = useState<Preset>("last_12");
  const [customFrom, setCustomFrom] = useState(monthKeyOf(addMonths(now, -11)));
  const [customTo, setCustomTo] = useState(nowKey);

  const [fromKey, toKey] = useMemo((): [string, string] => {
    if (preset === "this_year") return [`${now.getFullYear()}-01`, nowKey];
    if (preset === "last_6") return [monthKeyOf(addMonths(now, -5)), nowKey];
    if (preset === "last_12") return [monthKeyOf(addMonths(now, -11)), nowKey];
    return customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
  }, [preset, now, nowKey, customFrom, customTo]);

  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const leads = useMemo(() => leadsQ.data ?? [], [leadsQ.data]);
  const opps = useMemo(() => oppsQ.data ?? [], [oppsQ.data]);
  const costOfSalesTarget = settingsQ.data?.cost_of_sales_target ?? 85;

  const monthlyData = useMemo(() => {
    const months = buildMonthRange(fromKey, toKey);
    const map = new Map<string, MonthBucket>(
      months.map((month) => [
        month,
        {
          month,
          label: monthLabel(month),
          salesTotal: 0,
          salesQuotes: [],
          revenueTotal: 0,
          revenueQuotes: [],
          revenueOpportunities: [],
          costTotal: 0,
          costTrackedRevenue: 0,
          costRatio: null,
          leadsCreated: 0,
          createdLeads: [],
          leadsConverted: 0,
          convertedLeads: [],
        },
      ]),
    );

    for (const q of quotes) {
      const t = chargeTotals(q.quote_lines, fxOf(q));
      const createdKey = q.created_at?.slice(0, 7);
      if (createdKey) {
        const bucket = map.get(createdKey);
        if (bucket) {
          bucket.salesTotal += t.sellIncl;
          bucket.salesQuotes.push(q);
        }
      }
      if (WON_QUOTE_STATUSES.includes(q.status) && q.accepted_at) {
        const acceptedKey = q.accepted_at.slice(0, 7);
        const bucket = map.get(acceptedKey);
        if (bucket) {
          bucket.revenueTotal += t.sell;
          bucket.costTotal += t.cost;
          bucket.costTrackedRevenue += t.sell;
          bucket.revenueQuotes.push(q);
        }
      }
    }

    // Real historical sales that pre-date the quoting system: completed
    // opportunities with no linked quote. No cost data exists for these
    // (never will be back-dated), so they count toward Sales/Revenue but
    // are deliberately excluded from costTrackedRevenue -- otherwise a
    // month with only this kind of revenue would misreport as 0% cost.
    for (const o of opps) {
      if (o.status !== "job_completed" || o.quote_id) continue;
      const key = o.updated_at?.slice(0, 7);
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) {
        bucket.salesTotal += o.value || 0;
        bucket.revenueTotal += o.value || 0;
        bucket.revenueOpportunities.push(o);
      }
    }

    for (const l of leads) {
      const createdKey = l.created_at?.slice(0, 7);
      if (createdKey) {
        const bucket = map.get(createdKey);
        if (bucket) {
          bucket.leadsCreated += 1;
          bucket.createdLeads.push(l);
        }
      }
      if (l.promoted_at) {
        const promotedKey = l.promoted_at.slice(0, 7);
        const bucket = map.get(promotedKey);
        if (bucket) {
          bucket.leadsConverted += 1;
          bucket.convertedLeads.push(l);
        }
      }
    }

    return months.map((month) => {
      const b = map.get(month)!;
      return {
        ...b,
        costRatio:
          b.costTrackedRevenue > 0
            ? (b.costTotal / b.costTrackedRevenue) * 100
            : null,
      };
    });
  }, [quotes, leads, opps, fromKey, toKey]);

  const [drill, setDrill] = useState<{ kind: DrillKind; bucket: MonthBucket } | null>(
    null,
  );
  const [openQuoteId, setOpenQuoteId] = useState<string | null>(null);

  const isLoading =
    quotesQ.isLoading || leadsQ.isLoading || oppsQ.isLoading || settingsQ.isLoading;
  const isError = quotesQ.isError || leadsQ.isError || oppsQ.isError || settingsQ.isError;

  if (isLoading) return <Loading />;
  if (isError) {
    return (
      <ErrorNote error={quotesQ.error ?? leadsQ.error ?? oppsQ.error ?? settingsQ.error} />
    );
  }

  function drillQuotes(kind: DrillKind, b: MonthBucket): Quote[] {
    if (kind === "sales") return b.salesQuotes;
    if (kind === "revenue" || kind === "ratio") return b.revenueQuotes;
    return [];
  }
  function drillOpportunities(kind: DrillKind, b: MonthBucket): Opportunity[] {
    if (kind === "sales" || kind === "revenue") return b.revenueOpportunities;
    return [];
  }
  function drillLeads(kind: DrillKind, b: MonthBucket): Lead[] {
    if (kind === "leadsCreated") return b.createdLeads;
    if (kind === "leadsConverted") return b.convertedLeads;
    return [];
  }
  const drillTitle: Record<DrillKind, string> = {
    sales: "Sales",
    revenue: "Revenue (accepted quotes)",
    ratio: "Cost of Sales — accepted quotes",
    leadsCreated: "Leads created",
    leadsConverted: "Leads converted to customer",
  };

  return (
    <>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        Sales, Revenue, Cost of Sales Ratio and lead flow by month. Click any
        bar or point to see the records behind it.
      </p>

      <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          {(
            [
              ["last_12", "Last 12 months"],
              ["last_6", "Last 6 months"],
              ["this_year", "This year"],
              ["custom", "Custom"],
            ] as [Preset, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm${preset === key ? "" : " outline"}`}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          ))}
          {preset === "custom" && (
            <>
              <input
                type="month"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ width: "auto" }}
              />
              <span className="muted">to</span>
              <input
                type="month"
                value={customTo}
                min={customFrom}
                max={nowKey}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ width: "auto" }}
              />
            </>
          )}
        </div>

        <ResponsiveContainer width="100%" height={420}>
          <ComposedChart data={monthlyData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="currency"
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => money(v)}
              width={90}
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              domain={[0, 120]}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `${v}%`}
              width={50}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tick={{ fontSize: 12 }}
              width={40}
              hide
            />
            <Tooltip
              formatter={(value, name) => {
                const v = Number(value) || 0;
                if (name === "Cost of Sales Ratio") return [`${v.toFixed(1)}%`, name];
                if (name === "Leads Created" || name === "Leads Converted")
                  return [v, name];
                return [money(v), name];
              }}
            />
            <Legend />
            <ReferenceLine
              yAxisId="ratio"
              y={costOfSalesTarget}
              stroke={COLORS.target}
              strokeDasharray="6 4"
              label={{
                value: `Target ${costOfSalesTarget}%`,
                position: "insideTopRight",
                fill: COLORS.target,
                fontSize: 11,
              }}
            />
            <Bar
              yAxisId="currency"
              dataKey="salesTotal"
              name="Sales"
              fill={COLORS.sales}
              radius={[3, 3, 0, 0]}
              onClick={(_, index) => setDrill({ kind: "sales", bucket: monthlyData[index] })}
              cursor="pointer"
            />
            <Bar
              yAxisId="currency"
              dataKey="revenueTotal"
              name="Revenue"
              fill={COLORS.revenue}
              radius={[3, 3, 0, 0]}
              onClick={(_, index) =>
                setDrill({ kind: "revenue", bucket: monthlyData[index] })
              }
              cursor="pointer"
            />
            <Line
              yAxisId="ratio"
              dataKey="costRatio"
              name="Cost of Sales Ratio"
              stroke={COLORS.ratio}
              strokeWidth={2}
              connectNulls
              dot={(props: unknown) => {
                const { cx, cy, index, key } = props as {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  key?: Key;
                };
                if (cx == null || cy == null || index == null) return <g key={key} />;
                return (
                  <circle
                    key={key}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={COLORS.ratio}
                    style={{ cursor: "pointer" }}
                    onClick={() => setDrill({ kind: "ratio", bucket: monthlyData[index] })}
                  />
                );
              }}
            />
            <Line
              yAxisId="count"
              dataKey="leadsCreated"
              name="Leads Created"
              stroke={COLORS.leadsCreated}
              strokeWidth={2}
              dot={(props: unknown) => {
                const { cx, cy, index, key } = props as {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  key?: Key;
                };
                if (cx == null || cy == null || index == null) return <g key={key} />;
                return (
                  <circle
                    key={key}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={COLORS.leadsCreated}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setDrill({ kind: "leadsCreated", bucket: monthlyData[index] })
                    }
                  />
                );
              }}
            />
            <Line
              yAxisId="count"
              dataKey="leadsConverted"
              name="Leads Converted"
              stroke={COLORS.leadsConverted}
              strokeWidth={2}
              dot={(props: unknown) => {
                const { cx, cy, index, key } = props as {
                  cx?: number;
                  cy?: number;
                  index?: number;
                  key?: Key;
                };
                if (cx == null || cy == null || index == null) return <g key={key} />;
                return (
                  <circle
                    key={key}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill={COLORS.leadsConverted}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setDrill({ kind: "leadsConverted", bucket: monthlyData[index] })
                    }
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {drill && (
        <Modal
          title={`${drillTitle[drill.kind]} — ${drill.bucket.label}`}
          onClose={() => setDrill(null)}
          wide
        >
          {drill.kind === "leadsCreated" || drill.kind === "leadsConverted" ? (
            drillLeads(drill.kind, drill.bucket).length === 0 ? (
              <p className="muted">No leads in this month.</p>
            ) : (
              <div className="table-wrap">
                <table className="table--compact">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>{drill.kind === "leadsConverted" ? "Converted" : "Created"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillLeads(drill.kind, drill.bucket).map((l) => (
                      <tr
                        key={l.id}
                        className="clickable"
                        onClick={() => {
                          setDrill(null);
                          navigate("/crm?tab=leads", { state: { openLeadId: l.id } });
                        }}
                      >
                        <td>
                          <strong>{l.company}</strong>
                        </td>
                        <td>{l.contact || "—"}</td>
                        <td>{l.lead_status?.name ?? "—"}</td>
                        <td>
                          {formatDate(
                            drill.kind === "leadsConverted" ? l.promoted_at : l.created_at,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : drillQuotes(drill.kind, drill.bucket).length === 0 &&
            drillOpportunities(drill.kind, drill.bucket).length === 0 ? (
            <p className="muted">No records in this month.</p>
          ) : (
            <>
              {drillQuotes(drill.kind, drill.bucket).length > 0 && (
                <div className="table-wrap">
                  <table className="table--compact">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Customer</th>
                        <th>Mode</th>
                        <th>Status</th>
                        <th className="num">
                          {drill.kind === "sales" ? "Sell (incl. VAT)" : "Sell (excl. VAT)"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillQuotes(drill.kind, drill.bucket).map((q) => {
                        const t = chargeTotals(q.quote_lines, fxOf(q));
                        return (
                          <tr
                            key={q.id}
                            className="clickable"
                            onClick={() => {
                              setDrill(null);
                              setOpenQuoteId(q.id);
                            }}
                          >
                            <td>
                              <strong>{q.reference}</strong>
                            </td>
                            <td>{q.client?.company ?? q.lead?.company ?? "—"}</td>
                            <td>{q.mode}</td>
                            <td>{q.status}</td>
                            <td className="num">
                              {money(drill.kind === "sales" ? t.sellIncl : t.sell)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {drillOpportunities(drill.kind, drill.bucket).length > 0 && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <p className="hint" style={{ marginBottom: 6 }}>
                    Historical shipments (no linked quote — no cost data, excluded
                    from Cost of Sales Ratio)
                  </p>
                  <table className="table--compact">
                    <thead>
                      <tr>
                        <th>Customer / Lead</th>
                        <th>Title</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillOpportunities(drill.kind, drill.bucket).map((o) => (
                        <tr
                          key={o.id}
                          className="clickable"
                          onClick={() => {
                            setDrill(null);
                            navigate("/crm?tab=opportunities", {
                              state: { openOpportunityId: o.id },
                            });
                          }}
                        >
                          <td>
                            <strong>
                              {o.client?.company ?? o.lead?.company ?? "—"}
                            </strong>
                          </td>
                          <td>{o.title || "—"}</td>
                          <td className="num">{money(o.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {openQuoteId && (
        <QuoteDetailModal
          quoteId={openQuoteId}
          onClose={() => setOpenQuoteId(null)}
        />
      )}
    </>
  );
}
