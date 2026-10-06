import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../../components/Modal";
import { ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useAllCampaignRecipients,
  useCompanySettings,
  useFollowUpLog,
  useJobs,
  useLeadStatuses,
  useLeads,
  useMailCampaigns,
  useOpportunities,
  useProfiles,
  useQuotes,
  useUpdateCompanySettings,
} from "../../lib/hooks";
import {
  chargeTotals,
  fxOf,
  synthesizeQuoteOpportunities,
  withLiveOpportunityValues,
} from "../../lib/calc";
import { money, timeAgo } from "../../lib/format";
import {
  OPPORTUNITY_STAGES,
  PIPE_STAGE_COLORS,
  WON_QUOTE_STATUSES,
  isShipmentComplete,
  type CompanySettingsPatch,
  type OpportunityStatus,
  type QuoteStatus,
} from "../../lib/types";

/** Targets for the quote KPI widgets (fixed for now). */
/** Defaults until migration 0118 adds the editable settings. */
const DEFAULT_WIN_RATE_TARGET = 50; // %, higher is better
const DEFAULT_TURNAROUND_TARGET_HRS = 4; // hours, lower is better

/** Green when the value meets its target, orange when not, plain when n/a. */
function kpiTone(v: number | null, good: (v: number) => boolean): string | undefined {
  if (v === null) return undefined;
  return good(v) ? "var(--green-dark)" : "var(--orange)";
}

/** "▲ 8.2%" / "▼ 3.1%". */
function arrow(pct: number): string {
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
}

/** Hours as "45 min" / "3.5 hrs" / "2.4 days". */
function duration(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} hrs`;
  return `${(h / 24).toFixed(1)} days`;
}

/** Selected reporting month (m is 0-based, like Date#getMonth). */
type Period = { y: number; m: number };
const currentPeriod = (): Period => {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() };
};
function inPeriod(iso: string | null | undefined, p: Period): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === p.y && d.getMonth() === p.m;
}
const periodLabel = (p: Period) =>
  new Date(p.y, p.m, 1).toLocaleString("en-ZA", { month: "long", year: "numeric" });

const OPEN_OPP_STATUSES: OpportunityStatus[] = [
  "new_lead",
  "quote_sent",
  "quote_accepted",
];

// New Lead + Quote Sent, quotes not yet won or lost.
const OPEN_QUOTE_STATUSES: QuoteStatus[] = ["open", "sent"];

const Icon = {
  revenue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5-1.3 2.2-3 2.5c-1.7.3-3 1.1-3 2.5s1.3 2.5 3 2.5 3-1.1 3-2.5" />
    </svg>
  ),
  profit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  ),
  leads: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  won: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  winRate: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  ),
  deal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 3h13l3 4v13a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  ratio: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="17" r="3" />
      <path d="M19 5L5 19" />
    </svg>
  ),
  pipeline: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M7 12h10M10 18h4" />
    </svg>
  ),
  convert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4v6h6M20 20v-6h-6" />
      <path d="M4 10a8 8 0 0114-3M20 14a8 8 0 01-14 3" />
    </svg>
  ),
};

export default function SalesDashboardTab() {
  const navigate = useNavigate();
  const quotesQ = useQuotes();
  const jobsQ = useJobs();
  const leadsQ = useLeads();
  const statusesQ = useLeadStatuses();
  const oppsQ = useOpportunities();
  const profilesQ = useProfiles();
  const campaignsQ = useMailCampaigns();
  const recipientsQ = useAllCampaignRecipients();
  const followLogQ = useFollowUpLog();
  const settingsQ = useCompanySettings();
  const [editingTargets, setEditingTargets] = useState(false);
  // Month the dashboard reports on, this month by default; step back to
  // review earlier months. Live views (pipeline, unbilled, open opps, lead
  // sources, activity) ignore it.
  const [period, setPeriod] = useState<Period>(currentPeriod);
  const nowP = currentPeriod();
  const isCurrent = period.y === nowP.y && period.m === nowP.m;
  const shift = (n: number) =>
    setPeriod((p) => {
      const d = new Date(p.y, p.m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const inMonthWord = isCurrent ? "this month" : `in ${periodLabel(period)}`;

  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, []);

  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const leads = useMemo(() => leadsQ.data ?? [], [leadsQ.data]);
  // A real opportunity's stored value never syncs once a quote is linked to
  // it, recompute live from the quote so pipeline totals below match what
  // the Opportunities board shows (see withLiveOpportunityValues).
  const opps = useMemo(
    () => withLiveOpportunityValues(oppsQ.data ?? [], quotesQ.data ?? []),
    [oppsQ.data, quotesQ.data],
  );
  const profileById = useMemo(() => {
    const m = new Map<string, { id: string; full_name: string | null }>();
    for (const p of profilesQ.data ?? []) m.set(p.id, p);
    return m;
  }, [profilesQ.data]);
  // Same rule the Opportunities board uses: every quote without a linked
  // opportunity is its own pipeline card. Keeps the Opportunities Pipeline
  // panel below in sync with what the board shows.
  const oppsWithQuotes = useMemo(
    () => [...opps, ...synthesizeQuoteOpportunities(quotes, opps, profileById)],
    [opps, quotes, profileById],
  );
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);
  const recipients = useMemo(() => recipientsQ.data ?? [], [recipientsQ.data]);
  const followLog = useMemo(() => followLogQ.data ?? [], [followLogQ.data]);

  const kpis = useMemo(() => {
    const acceptedThisMonth = quotes.filter(
      (q) => WON_QUOTE_STATUSES.includes(q.status) && inPeriod(q.accepted_at, period),
    );
    const totals = acceptedThisMonth.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
    const revenue = totals.reduce((s, t) => s + t.sell, 0);
    // Same figure as the printable quotation's Grand Total (sell + VAT),
    // summed across every accepted/completed quote, VAT-inclusive, unlike
    // Revenue below which stays excl. VAT.
    const sales = totals.reduce((s, t) => s + t.sellIncl, 0);
    const grossProfit = totals.reduce((s, t) => s + t.gp, 0);
    // Cost of Sales Ratio = Total Cost of Sales ÷ Revenue (excl. VAT) × 100.
    // Target 85% or lower, going over erodes margin.
    const costOfSales = totals.reduce((s, t) => s + t.cost, 0);
    const costRatio = revenue > 0 ? (costOfSales / revenue) * 100 : 0;
    const leadsThisMonth = leads.filter((l) => inPeriod(l.created_at, period));
    const newLeads = leadsThisMonth.length;
    // Open Pipeline: VAT-inclusive total of this month's not-yet-won quotes
    // (New Lead + Quote Sent), same Grand Total formula as Revenue/Sales
    // above, just for quotes that haven't been accepted yet.
    const openQuotesThisMonth = quotes.filter(
      (q) => OPEN_QUOTE_STATUSES.includes(q.status) && inPeriod(q.created_at, period),
    );
    const openPipeline = openQuotesThisMonth.reduce(
      (s, q) => s + chargeTotals(q.quote_lines, fxOf(q)).sellIncl,
      0,
    );
    const openOppCount = openQuotesThisMonth.length;
    // Lead → Customer: scoped to this month's leads too, same cohort as
    // Total Leads above, how many of them have converted so far.
    const converted = leadsThisMonth.filter((l) => l.promoted_at).length;
    const convRate =
      leadsThisMonth.length > 0 ? (converted / leadsThisMonth.length) * 100 : 0;
    return {
      revenue,
      sales,
      grossProfit,
      costOfSales,
      costRatio,
      newLeads,
      wonCount: acceptedThisMonth.length,
      wonValue: revenue,
      openPipeline,
      openOppCount,
      converted,
      totalLeads: leadsThisMonth.length,
      convRate,
    };
  }, [quotes, leads, period]);

  // Quote Win Rate / Average Deal Size / Quote Turnaround / Revenue vs
  // Last Month. Revenue figures excl. VAT. "Decided" this month = won
  // (accepted_at) + lost (lost_at, else updated_at) + expired (still
  // open/sent with valid_until passed this month). Turnaround = median of
  // enquiry start (the lead's created_at, else the quote's) -> sent_at, for
  // quotes sent this month (sent_at is stamped from migration 0111 on).
  const quoteKpis = useMemo(() => {
    const now = new Date();
    const { y, m } = period;
    const last = new Date(y, m - 1, 1);
    const inMonth = (iso: string | null | undefined, yy: number, mm: number) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d.getFullYear() === yy && d.getMonth() === mm;
    };
    const p2 = (n: number) => String(n).padStart(2, "0");
    const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const won = (yy: number, mm: number) =>
      quotes.filter(
        (q) => WON_QUOTE_STATUSES.includes(q.status) && inMonth(q.accepted_at, yy, mm),
      );
    const rev = (qs: typeof quotes) =>
      qs.reduce((s, q) => s + chargeTotals(q.quote_lines, fxOf(q)).sell, 0);
    const wonNow = won(y, m);
    const wonLast = won(last.getFullYear(), last.getMonth());
    const revNow = rev(wonNow);
    const revLast = rev(wonLast);

    const lost = quotes.filter(
      (q) => q.status === "lost" && inMonth(q.lost_at ?? q.updated_at, y, m),
    ).length;
    const expired = quotes.filter(
      (q) =>
        (q.status === "open" || q.status === "sent") &&
        !!q.valid_until &&
        q.valid_until.slice(0, 10) < today &&
        inMonth(q.valid_until.slice(0, 10) + "T12:00:00", y, m),
    ).length;
    const decided = wonNow.length + lost + expired;
    const winRate = decided > 0 ? (wonNow.length / decided) * 100 : null;

    const avgNow = wonNow.length ? revNow / wonNow.length : 0;
    const avgLast = wonLast.length ? revLast / wonLast.length : 0;
    const avgChange = avgLast > 0 && wonNow.length ? ((avgNow - avgLast) / avgLast) * 100 : null;

    const leadCreated = new Map(leads.map((l) => [l.id, l.created_at]));
    const hours = quotes
      .filter((q) => inMonth(q.sent_at, y, m))
      .map((q) => {
        const start = (q.lead_id && leadCreated.get(q.lead_id)) || q.created_at;
        return (new Date(q.sent_at as string).getTime() - new Date(start).getTime()) / 3_600_000;
      })
      .filter((h) => h >= 0)
      .sort((a, b) => a - b);
    const median =
      hours.length === 0
        ? null
        : hours.length % 2
          ? hours[(hours.length - 1) / 2]
          : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2;

    const revChange = revLast > 0 ? ((revNow - revLast) / revLast) * 100 : null;
    return {
      wonCount: wonNow.length,
      decided,
      winRate,
      avgNow,
      avgChange,
      turnaroundHrs: median,
      sentCount: hours.length,
      revNow,
      revLast,
      revChange,
      lastMonthName: last.toLocaleString("en-ZA", { month: "long" }),
    };
  }, [quotes, leads, period]);

  const oppPipeline = useMemo(() => {
    const rows = OPPORTUNITY_STAGES.map((stage) => {
      const inStage = oppsWithQuotes.filter((o) => o.status === stage.key);
      const value = inStage.reduce((s, o) => s + (o.value || 0), 0);
      // Short label (before the " - ") so the pipeline row never wraps.
      return {
        key: stage.key,
        label: stage.label.split(" - ")[0],
        count: inStage.length,
        value,
      };
    });
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    // Scaled against an overall pipeline target when one's set (Edit
    // Targets), otherwise against total pipeline value across every stage,
    // never against just whichever single stage holds the most, or that
    // stage always renders as a full bar regardless of how it's doing.
    const target = settingsQ.data?.opportunities_pipeline_target || 0;
    const max = Math.max(1, target > 0 ? target : totalValue);
    const openValue = rows
      .filter((r) => OPEN_OPP_STATUSES.includes(r.key))
      .reduce((s, r) => s + r.value, 0);
    return {
      rows,
      max,
      totalValue,
      openValue,
      total: oppsWithQuotes.length,
      target,
    };
  }, [oppsWithQuotes, settingsQ.data]);

  // Financial Snapshot. Month to date = quotes won (accepted/completed) with
  // accepted_at this month; Revenue / Cost / GP are excl. VAT (revenue
  // figures). Unbilled = every shipment without an invoice date, valued at
  // its quote's Grand Total incl. VAT (what is still to be billed).
  const snapshot = useMemo(() => {
    const won = quotes.filter(
      (q) => WON_QUOTE_STATUSES.includes(q.status) && inPeriod(q.accepted_at, period),
    );
    const t = won.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
    const revenue = t.reduce((s, x) => s + x.sell, 0);
    const cost = t.reduce((s, x) => s + x.cost, 0);
    const gp = revenue - cost;
    const margin = revenue > 0 ? (gp / revenue) * 100 : 0;
    const quoteById = new Map(quotes.map((q) => [q.id, q]));
    const notInvoiced = (jobsQ.data ?? []).filter((j) => !j.invoiced_at);
    const unbilledValue = notInvoiced.reduce((s, j) => {
      const q = j.quote_id ? quoteById.get(j.quote_id) : undefined;
      return s + (q ? chargeTotals(q.quote_lines, fxOf(q)).sellIncl : 0);
    }, 0);
    const completedNotInvoiced = notInvoiced.filter(isShipmentComplete).length;
    return {
      revenue,
      cost,
      gp,
      margin,
      wonCount: won.length,
      unbilledValue,
      unbilledCount: notInvoiced.length,
      completedNotInvoiced,
    };
  }, [quotes, jobsQ.data, period]);

  const leaderboard = useMemo(() => {
    const people = (profilesQ.data ?? []).filter(
      (p) => p.role === "admin" || p.role === "user",
    );
    return people
      .map((p) => {
        const mine = quotes.filter(
          (q) =>
            WON_QUOTE_STATUSES.includes(q.status) &&
            inPeriod(q.accepted_at, period) &&
            q.sales_person_id === p.id,
        );
        const t = mine.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
        const revenue = t.reduce((s, x) => s + x.sell, 0);
        const gp = t.reduce((s, x) => s + x.gp, 0);
        const openOpps = opps.filter(
          (o) => o.sales_person_id === p.id && OPEN_OPP_STATUSES.includes(o.status),
        );
        const pipelineValue = openOpps.reduce((s, o) => s + (o.value || 0), 0);
        return {
          id: p.id,
          name: p.full_name || "—",
          revenue,
          gp,
          openOpps: openOpps.length,
          pipelineValue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [profilesQ.data, quotes, opps, period]);

  const campaignPerf = useMemo(() => {
    const byCampaign = new Map<
      string,
      { attempted: number; opened: number; clicked: number }
    >();
    for (const r of recipients) {
      const cur = byCampaign.get(r.campaign_id) ?? {
        attempted: 0,
        opened: 0,
        clicked: 0,
      };
      if (r.status !== "pending") cur.attempted += 1;
      if (r.status === "opened" || r.status === "clicked") cur.opened += 1;
      if (r.status === "clicked") cur.clicked += 1;
      byCampaign.set(r.campaign_id, cur);
    }
    const sentThisMonth = campaigns.filter((c) => inPeriod(c.sent_at, period));
    let mAttempted = 0;
    let mOpened = 0;
    let mClicked = 0;
    for (const c of sentThisMonth) {
      const s = byCampaign.get(c.id);
      if (!s) continue;
      mAttempted += s.attempted;
      mOpened += s.opened;
      mClicked += s.clicked;
    }
    const recent = [...campaigns]
      .filter((c) => c.sent_at)
      .sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))
      .slice(0, 5)
      .map((c) => ({ campaign: c, stats: byCampaign.get(c.id) }));
    return {
      recent,
      monthSent: mAttempted,
      monthOpenRate: mAttempted > 0 ? (mOpened / mAttempted) * 100 : 0,
      monthClickRate: mAttempted > 0 ? (mClicked / mAttempted) * 100 : 0,
    };
  }, [recipients, campaigns, period]);

  const leadSources = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of leads) {
      const key = (l.source || "").trim() || "Unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const rows = [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...rows.map((r) => r.count));
    return { rows, max };
  }, [leads]);

  const activity = useMemo(() => {
    const statusName = new Map(
      (statusesQ.data ?? []).map((s) => [s.id, s.name]),
    );
    const stageLabel = new Map(OPPORTUNITY_STAGES.map((s) => [s.key, s.label]));
    type Item = { when: string; kind: string; text: string; tone: string };
    const items: Item[] = [];
    for (const l of leads) {
      items.push({
        when: l.created_at,
        kind: "Lead",
        tone: "tone-start",
        text: `${l.company}${
          l.lead_status_id ? ` · ${statusName.get(l.lead_status_id) ?? ""}` : ""
        }`,
      });
    }
    for (const o of opps) {
      items.push({
        when: o.created_at,
        kind: "Opportunity",
        tone: "tone-mid",
        text: `${o.lead?.company ?? o.client?.company ?? o.title ?? "Opportunity"} · ${
          stageLabel.get(o.status) ?? o.status
        }`,
      });
    }
    for (const c of campaigns) {
      if (!c.sent_at) continue;
      items.push({
        when: c.sent_at,
        kind: "Campaign",
        tone: "tone-done",
        text: `${c.name} sent`,
      });
    }
    for (const f of followLog) {
      items.push({
        when: f.created_at,
        kind: "Follow-up",
        tone: "tone-mid",
        text: `${f.rule?.name ?? f.trigger} → ${f.email}`,
      });
    }
    return items
      .filter((i) => i.when)
      .sort((a, b) => b.when.localeCompare(a.when))
      .slice(0, 12);
  }, [leads, opps, campaigns, followLog, statusesQ.data]);

  const isLoading =
    quotesQ.isLoading ||
    leadsQ.isLoading ||
    oppsQ.isLoading ||
    profilesQ.isLoading ||
    settingsQ.isLoading;
  const isError =
    quotesQ.isError || leadsQ.isError || oppsQ.isError || settingsQ.isError;

  if (isLoading) {
    return (
      <div className="panel">
        <Loading />
      </div>
    );
  }
  if (isError || !settingsQ.data) {
    return (
      <div className="panel">
        <ErrorNote error={quotesQ.error ?? leadsQ.error ?? settingsQ.error} />
      </div>
    );
  }

  const settings = settingsQ.data;
  const winRateTarget = settings.win_rate_target ?? DEFAULT_WIN_RATE_TARGET;
  const turnaroundTarget =
    settings.quote_turnaround_target_hrs ?? DEFAULT_TURNAROUND_TARGET_HRS;
  const w = (v: number, max: number) => (grown ? `${(v / max) * 100}%` : "0%");

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Sales performance for <strong>{periodLabel(period)}</strong>
          {isCurrent ? " (month to date)" : ""}, pipeline, unbilled and lead
          sources are always live.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="btn outline"
            onClick={() => shift(-1)}
            title="Previous month"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span style={{ fontWeight: 700, minWidth: 130, textAlign: "center" }}>
            {periodLabel(period)}
          </span>
          <button
            className="btn outline"
            onClick={() => shift(1)}
            disabled={isCurrent}
            title="Next month"
            aria-label="Next month"
          >
            ›
          </button>
          {!isCurrent && (
            <button className="btn outline" onClick={() => setPeriod(currentPeriod())}>
              This Month
            </button>
          )}
          <button className="btn outline" onClick={() => setEditingTargets(true)}>
            Edit Targets
          </button>
        </div>
      </div>

      <div className="dash-kpis sales-kpis">
        <SalesKpi
          icon={Icon.sales}
          label="Total Sales (incl. VAT)"
          value={money(kpis.sales)}
          actual={kpis.sales}
          target={settings.sales_target}
          targetLabel={money(settings.sales_target)}
        />
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.pipeline}</span>
            <span className="kpi-label">Open Pipeline</span>
          </div>
          <div className="kpi-value">{money(kpis.openPipeline)}</div>
          <div className="kpi-foot">
            <span>
              {kpis.openOppCount} open quote
              {kpis.openOppCount === 1 ? "" : "s"} {inMonthWord}
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.revenue}</span>
            <span className="kpi-label">Total Revenue</span>
          </div>
          <div className="kpi-value">{money(kpis.revenue)}</div>
          <div className="kpi-foot">
            <span>Excl. VAT, see Cost of Sales Ratio for the margin target</span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.profit}</span>
            <span className="kpi-label">Total Gross Profit</span>
          </div>
          <div className="kpi-value">{money(kpis.grossProfit)}</div>
          <div className="kpi-foot">
            <span>Revenue minus cost of sales, {inMonthWord}</span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.ratio}</span>
            <span className="kpi-label">Cost of Sales Ratio</span>
          </div>
          <div
            className="kpi-value"
            style={{
              color:
                kpis.costRatio <= settings.cost_of_sales_target
                  ? "var(--green-dark)"
                  : "var(--orange)",
            }}
          >
            {kpis.costRatio.toFixed(1)}%
          </div>
          <div className="kpi-foot">
            <span>
              {money(kpis.costOfSales)} cost ÷ {money(kpis.revenue)} revenue · target ≤{" "}
              {settings.cost_of_sales_target}%
            </span>
          </div>
        </div>
        <SalesKpi
          icon={Icon.leads}
          label="Total Leads"
          value={String(kpis.newLeads)}
          actual={kpis.newLeads}
          target={settings.sales_new_leads_target}
          targetLabel={String(settings.sales_new_leads_target)}
        />
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.convert}</span>
            <span className="kpi-label">Lead to Customer</span>
          </div>
          <div className="kpi-value">{kpis.convRate.toFixed(0)}%</div>
          <div className="kpi-foot">
            <span>
              {kpis.converted} of {kpis.totalLeads} leads converted
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.won}</span>
            <span className="kpi-label">Quote Accepted</span>
          </div>
          <div className="kpi-value">{kpis.wonCount}</div>
          <div className="kpi-foot">
            <span>{money(kpis.wonValue)} won {inMonthWord}</span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.winRate}</span>
            <span className="kpi-label">Quote Win Rate</span>
          </div>
          <div
            className="kpi-value"
            style={{ color: kpiTone(quoteKpis.winRate, (v) => v >= winRateTarget) }}
          >
            {quoteKpis.winRate === null ? "—" : `${quoteKpis.winRate.toFixed(0)}%`}
          </div>
          <div className="kpi-foot">
            <span>
              {quoteKpis.wonCount} of {quoteKpis.decided} decided quotes · target ≥{" "}
              {winRateTarget}%
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.deal}</span>
            <span className="kpi-label">Average Deal Size</span>
          </div>
          <div className="kpi-value">
            {quoteKpis.wonCount ? money(quoteKpis.avgNow) : "—"}
          </div>
          <div className="kpi-foot">
            <span>
              per won quote, excl. VAT
              {quoteKpis.avgChange !== null && (
                <>
                  {" · "}
                  <span style={{ color: kpiTone(quoteKpis.avgChange, (v) => v >= 0) }}>
                    {arrow(quoteKpis.avgChange)}
                  </span>{" "}
                  vs last month
                </>
              )}
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.clock}</span>
            <span className="kpi-label">Quote Turnaround</span>
          </div>
          <div
            className="kpi-value"
            style={{
              color: kpiTone(quoteKpis.turnaroundHrs, (v) => v < turnaroundTarget),
            }}
          >
            {quoteKpis.turnaroundHrs === null ? "—" : duration(quoteKpis.turnaroundHrs)}
          </div>
          <div className="kpi-foot">
            <span>
              {quoteKpis.sentCount
                ? `Median, ${inMonthWord} · target < ${turnaroundTarget} hrs`
                : `No quotes sent ${inMonthWord}`}
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.trend}</span>
            <span className="kpi-label">Revenue vs Last Month</span>
          </div>
          <div
            className="kpi-value"
            style={{ color: kpiTone(quoteKpis.revChange, (v) => v >= 0) }}
          >
            {quoteKpis.revChange === null ? "—" : arrow(quoteKpis.revChange)}
          </div>
          <div className="kpi-foot">
            <span>
              {money(quoteKpis.revNow)} vs {money(quoteKpis.revLast)} in{" "}
              {quoteKpis.lastMonthName}
            </span>
          </div>
        </div>
      </div>

      <div className="dash-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Opportunities Pipeline</h2>
              <p>Value by stage (incl. VAT) · click to open the board</p>
            </div>
            <div className="mini-stats">
              <div>
                <div className="k">Total value</div>
                <div className="v">{money(oppPipeline.totalValue)}</div>
              </div>
              <div>
                <div className="k">Open value</div>
                <div className="v">{money(oppPipeline.openValue)}</div>
              </div>
              <div>
                <div className="k">Opportunities</div>
                <div className="v">{oppPipeline.total}</div>
              </div>
              {oppPipeline.target > 0 && (
                <div>
                  <div className="k">Target</div>
                  <div className="v">{money(oppPipeline.target)}</div>
                </div>
              )}
            </div>
          </div>
          <div className="pipe">
            {oppPipeline.rows.map((r, i) => (
              <button
                key={r.key}
                className="pipe-row"
                onClick={() => navigate("/crm?tab=opportunities")}
              >
                <span className="nm">{r.label}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{
                      width: w(r.value, oppPipeline.max),
                      background: PIPE_STAGE_COLORS[i],
                    }}
                  />
                </span>
                <span>
                  <span className="amt">{money(r.value)}</span>
                  <span className="cnt"> · {r.count}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Financial Snapshot</h2>
              <p>{isCurrent ? "Month to date" : periodLabel(period)} · won quotes, excl. VAT · unbilled is live</p>
            </div>
          </div>
          <div className="fin-snap">
            <div className="fin-tile">
              <div className="k">Revenue</div>
              <div className="v">{money(snapshot.revenue)}</div>
              <div className="s">
                {snapshot.wonCount} won quote{snapshot.wonCount === 1 ? "" : "s"}
              </div>
            </div>
            <div className="fin-tile">
              <div className="k">Cost</div>
              <div className="v">{money(snapshot.cost)}</div>
            </div>
            <div className="fin-tile">
              <div className="k">Gross Profit</div>
              <div className="v">{money(snapshot.gp)}</div>
            </div>
            <div className="fin-tile">
              <div className="k">GP Margin</div>
              <div className="v">{snapshot.margin.toFixed(1)}%</div>
            </div>
            <button
              className="fin-tile is-link"
              onClick={() => navigate("/jobs", { state: { filter: "uninvoiced" } })}
              title="Open the shipments not yet invoiced"
            >
              <div className="k">Unbilled Shipments</div>
              <div className="v">{money(snapshot.unbilledValue)}</div>
              <div className="s">
                {snapshot.unbilledCount} shipment{snapshot.unbilledCount === 1 ? "" : "s"} · incl. VAT
              </div>
            </button>
            <button
              className={`fin-tile is-link${snapshot.completedNotInvoiced ? " is-alert" : ""}`}
              onClick={() =>
                navigate("/jobs/completed", { state: { filter: "uninvoiced" } })
              }
              title="Open delivered shipments not yet invoiced"
            >
              <div className="k">Completed Not Invoiced</div>
              <div className="v">{snapshot.completedNotInvoiced}</div>
              <div className="s">delivered, awaiting invoice</div>
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Sales Person Leaderboard</h2>
            <p>Won revenue &amp; gross profit {inMonthWord}, plus open pipeline (live)</p>
          </div>
        </div>
        {leaderboard.length === 0 ? (
          <p className="muted">No team members yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table--compact">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Revenue</th>
                  <th>Gross Profit</th>
                  <th>Open opps</th>
                  <th>Pipeline value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td>{money(r.revenue)}</td>
                    <td>{money(r.gp)}</td>
                    <td>{r.openOpps}</td>
                    <td>{money(r.pipelineValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="dash-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Campaign Performance</h2>
              <p>Mailer opens &amp; clicks · click a campaign for detail</p>
            </div>
            <div className="mini-stats">
              <div>
                <div className="k">{isCurrent ? "Sent this month" : `Sent in ${periodLabel(period).split(" ")[0]}`}</div>
                <div className="v">{campaignPerf.monthSent}</div>
              </div>
              <div>
                <div className="k">Open rate</div>
                <div className="v">{campaignPerf.monthOpenRate.toFixed(0)}%</div>
              </div>
              <div>
                <div className="k">Click rate</div>
                <div className="v">{campaignPerf.monthClickRate.toFixed(0)}%</div>
              </div>
            </div>
          </div>
          {campaignPerf.recent.length === 0 ? (
            <p className="muted">No campaigns sent yet.</p>
          ) : (
            <div className="pipe">
              {campaignPerf.recent.map(({ campaign, stats }) => {
                const attempted = stats?.attempted ?? 0;
                const openPct =
                  attempted > 0 ? ((stats?.opened ?? 0) / attempted) * 100 : 0;
                return (
                  <button
                    key={campaign.id}
                    className="pipe-row"
                    onClick={() => navigate("/crm?tab=campaigns")}
                  >
                    <span className="nm">{campaign.name}</span>
                    <span className="track">
                      <span className="fill" style={{ width: w(openPct, 100) }} />
                    </span>
                    <span>
                      <span className="amt">{openPct.toFixed(0)}% open</span>
                      <span className="cnt"> · {attempted} sent</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Lead Sources</h2>
              <p>Where your {leads.length} leads came from</p>
            </div>
          </div>
          {leadSources.rows.length === 0 ? (
            <p className="muted">No leads yet.</p>
          ) : (
            <div className="funnel">
              {leadSources.rows.map((r) => (
                <div className="funnel-step" key={r.name}>
                  <div className="nm">{r.name}</div>
                  <div className="track">
                    <div
                      className="fill"
                      style={{ width: w(r.count, leadSources.max) }}
                    />
                  </div>
                  <div className="ct">{r.count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent Activity</h2>
            <p>Latest across leads, opportunities, campaigns and follow-ups</p>
          </div>
        </div>
        {activity.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <div className="act-feed">
            {activity.map((a, i) => (
              <div className="act-row" key={i}>
                <span className={`ms-tag ${a.tone}`}>{a.kind}</span>
                <span className="act-text">{a.text}</span>
                <span className="act-when">{timeAgo(a.when)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingTargets && (
        <TargetsModal
          settings={settings}
          onClose={() => setEditingTargets(false)}
        />
      )}
    </>
  );
}

function SalesKpi({
  icon,
  label,
  value,
  actual,
  target,
  targetLabel,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  actual: number;
  target: number;
  targetLabel: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  return (
    <div className="kpi static">
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        {target > 0 ? (
          <>
            <span className="kpi-share">
              <span style={{ width: `${pct}%` }} />
            </span>
            <span>
              {pct}% of {targetLabel}
            </span>
          </>
        ) : (
          <span>No target set</span>
        )}
      </div>
    </div>
  );
}

function TargetsModal({
  settings,
  onClose,
}: {
  settings: {
    sales_target: number;
    sales_new_leads_target: number;
    cost_of_sales_target: number;
    opportunities_pipeline_target: number;
    quotes_pipeline_target: number;
    win_rate_target?: number;
    quote_turnaround_target_hrs?: number;
  };
  onClose: () => void;
}) {
  // Only offered once migration 0118 has added the columns.
  const hasQuoteKpiTargets = settings.win_rate_target !== undefined;
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      sales_target: Number(fd.get("sales_target")) || 0,
      cost_of_sales_target: Number(fd.get("cost_of_sales_target")) || 0,
      sales_new_leads_target: Number(fd.get("sales_new_leads_target")) || 0,
      opportunities_pipeline_target:
        Number(fd.get("opportunities_pipeline_target")) || 0,
    };
    if (hasQuoteKpiTargets) {
      patch.win_rate_target = Number(fd.get("win_rate_target")) || 0;
      patch.quote_turnaround_target_hrs =
        Number(fd.get("quote_turnaround_target_hrs")) || 0;
    }
    try {
      await update.mutateAsync(patch);
      toast("Targets saved");
      onClose();
    } catch (e2) {
      toastError(e2 instanceof Error ? e2.message : "Could not save");
    }
  }

  return (
    <Modal title="Monthly Sales Targets" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Sales Target (R)</label>
          <input
            name="sales_target"
            type="number"
            step="0.01"
            defaultValue={settings.sales_target}
          />
        </div>
        <div className="field">
          <label>Cost of Sales Ratio Target (%)</label>
          <input
            name="cost_of_sales_target"
            type="number"
            step="0.1"
            defaultValue={settings.cost_of_sales_target}
          />
        </div>
        {hasQuoteKpiTargets && (
          <div className="grid2">
            <div className="field">
              <label>Quote Win Rate Target (%)</label>
              <input
                name="win_rate_target"
                type="number"
                step="1"
                defaultValue={settings.win_rate_target}
              />
            </div>
            <div className="field">
              <label>Quote Turnaround Target (hrs)</label>
              <input
                name="quote_turnaround_target_hrs"
                type="number"
                step="0.5"
                defaultValue={settings.quote_turnaround_target_hrs}
              />
            </div>
          </div>
        )}
        <div className="field">
          <label>New Leads Target</label>
          <input
            name="sales_new_leads_target"
            type="number"
            defaultValue={settings.sales_new_leads_target}
          />
        </div>
        <div className="field">
          <label>Opportunities Pipeline Target (R)</label>
          <input
            name="opportunities_pipeline_target"
            type="number"
            step="0.01"
            placeholder="0 = scale against the pipeline's own total"
            defaultValue={settings.opportunities_pipeline_target}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
