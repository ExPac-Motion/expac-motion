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
  useLeadStatuses,
  useLeads,
  useMailCampaigns,
  useOpportunities,
  useProfiles,
  useQuotes,
  useUpdateCompanySettings,
} from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import { money, timeAgo } from "../../lib/format";
import {
  OPPORTUNITY_STAGES,
  STATUS_LABEL,
  STATUS_ORDER,
  type CompanySettingsPatch,
  type OpportunityStatus,
} from "../../lib/types";

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

const OPEN_OPP_STATUSES: OpportunityStatus[] = [
  "new_lead",
  "quote_sent",
  "quote_accepted",
];

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

function MiniBar({ pct }: { pct: number }) {
  return (
    <span className="mini-bar">
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

export default function SalesDashboardTab() {
  const navigate = useNavigate();
  const quotesQ = useQuotes();
  const leadsQ = useLeads();
  const statusesQ = useLeadStatuses();
  const oppsQ = useOpportunities();
  const profilesQ = useProfiles();
  const campaignsQ = useMailCampaigns();
  const recipientsQ = useAllCampaignRecipients();
  const followLogQ = useFollowUpLog();
  const settingsQ = useCompanySettings();
  const [editingTargets, setEditingTargets] = useState(false);

  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, []);

  const quotes = useMemo(() => quotesQ.data ?? [], [quotesQ.data]);
  const leads = useMemo(() => leadsQ.data ?? [], [leadsQ.data]);
  const opps = useMemo(() => oppsQ.data ?? [], [oppsQ.data]);
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);
  const recipients = useMemo(() => recipientsQ.data ?? [], [recipientsQ.data]);
  const followLog = useMemo(() => followLogQ.data ?? [], [followLogQ.data]);

  const kpis = useMemo(() => {
    const acceptedThisMonth = quotes.filter(
      (q) => q.status === "accepted" && isThisMonth(q.accepted_at),
    );
    const totals = acceptedThisMonth.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
    const revenue = totals.reduce((s, t) => s + t.sell, 0);
    const grossProfit = totals.reduce((s, t) => s + t.gp, 0);
    const newLeads = leads.filter((l) => isThisMonth(l.created_at)).length;
    const openPipeline = opps
      .filter((o) => OPEN_OPP_STATUSES.includes(o.status))
      .reduce((s, o) => s + (o.value || 0), 0);
    const openOppCount = opps.filter((o) =>
      OPEN_OPP_STATUSES.includes(o.status),
    ).length;
    const converted = leads.filter((l) => l.promoted_at).length;
    const convRate = leads.length > 0 ? (converted / leads.length) * 100 : 0;
    return {
      revenue,
      grossProfit,
      newLeads,
      wonCount: acceptedThisMonth.length,
      wonValue: revenue,
      openPipeline,
      openOppCount,
      converted,
      totalLeads: leads.length,
      convRate,
    };
  }, [quotes, leads, opps]);

  const oppPipeline = useMemo(() => {
    const rows = OPPORTUNITY_STAGES.map((stage) => {
      const inStage = opps.filter((o) => o.status === stage.key);
      const value = inStage.reduce((s, o) => s + (o.value || 0), 0);
      return { key: stage.key, label: stage.label, count: inStage.length, value };
    });
    const max = Math.max(1, ...rows.map((r) => r.value));
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const openValue = rows
      .filter((r) => OPEN_OPP_STATUSES.includes(r.key))
      .reduce((s, r) => s + r.value, 0);
    return { rows, max, totalValue, openValue, total: opps.length };
  }, [opps]);

  const quotePipeline = useMemo(() => {
    const rows = STATUS_ORDER.map((st) => {
      const inStatus = quotes.filter((q) => q.status === st);
      const value = inStatus
        .map((q) => chargeTotals(q.quote_lines, fxOf(q)).sell)
        .reduce((s, v) => s + v, 0);
      return { st, count: inStatus.length, value };
    });
    const max = Math.max(1, ...rows.map((r) => r.value));
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const won = rows.find((r) => r.st === "accepted")?.count ?? 0;
    const lost = rows.find((r) => r.st === "lost")?.count ?? 0;
    const winRate = won + lost > 0 ? (won / (won + lost)) * 100 : 0;
    return { rows, max, totalValue, winRate, total: quotes.length };
  }, [quotes]);

  const leaderboard = useMemo(() => {
    const people = (profilesQ.data ?? []).filter((p) => p.role !== "client");
    return people
      .map((p) => {
        const mine = quotes.filter(
          (q) =>
            q.status === "accepted" &&
            isThisMonth(q.accepted_at) &&
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
          revTarget: p.sales_revenue_target,
          gp,
          gpTarget: p.sales_gp_target,
          openOpps: openOpps.length,
          pipelineValue,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [profilesQ.data, quotes, opps]);

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
    const sentThisMonth = campaigns.filter((c) => isThisMonth(c.sent_at));
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
  }, [recipients, campaigns]);

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
          A live view of the whole Sales CRM — this calendar month unless noted.
        </p>
        <button className="btn outline" onClick={() => setEditingTargets(true)}>
          Edit Targets
        </button>
      </div>

      <div className="dash-kpis sales-kpis">
        <SalesKpi
          icon={Icon.revenue}
          label="Revenue"
          value={money(kpis.revenue)}
          actual={kpis.revenue}
          target={settings.sales_revenue_target}
          targetLabel={money(settings.sales_revenue_target)}
        />
        <SalesKpi
          icon={Icon.profit}
          label="Gross Profit"
          value={money(kpis.grossProfit)}
          actual={kpis.grossProfit}
          target={settings.sales_gp_target}
          targetLabel={money(settings.sales_gp_target)}
        />
        <SalesKpi
          icon={Icon.leads}
          label="New Leads"
          value={String(kpis.newLeads)}
          actual={kpis.newLeads}
          target={settings.sales_new_leads_target}
          targetLabel={String(settings.sales_new_leads_target)}
        />
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.won}</span>
            <span className="kpi-label">Quotes Won</span>
          </div>
          <div className="kpi-value">{kpis.wonCount}</div>
          <div className="kpi-foot">
            <span>{money(kpis.wonValue)} won this month</span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.pipeline}</span>
            <span className="kpi-label">Open Pipeline</span>
          </div>
          <div className="kpi-value">{money(kpis.openPipeline)}</div>
          <div className="kpi-foot">
            <span>
              {kpis.openOppCount} open opportunit
              {kpis.openOppCount === 1 ? "y" : "ies"}
            </span>
          </div>
        </div>
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.convert}</span>
            <span className="kpi-label">Lead → Customer</span>
          </div>
          <div className="kpi-value">{kpis.convRate.toFixed(0)}%</div>
          <div className="kpi-foot">
            <span>
              {kpis.converted} of {kpis.totalLeads} leads converted
            </span>
          </div>
        </div>
      </div>

      <div className="dash-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Opportunities Pipeline</h2>
              <p>Value by stage · click to open the board</p>
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
            </div>
          </div>
          <div className="pipe">
            {oppPipeline.rows.map((r) => (
              <button
                key={r.key}
                className="pipe-row"
                onClick={() => navigate("/crm?tab=opportunities")}
              >
                <span className="nm">{r.label}</span>
                <span className="track">
                  <span className="fill" style={{ width: w(r.value, oppPipeline.max) }} />
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
              <h2>Quotes by Status</h2>
              <p>Value by status · click to open the list</p>
            </div>
            <div className="mini-stats">
              <div>
                <div className="k">Total value</div>
                <div className="v">{money(quotePipeline.totalValue)}</div>
              </div>
              <div>
                <div className="k">Win rate</div>
                <div className="v">{quotePipeline.winRate.toFixed(0)}%</div>
              </div>
              <div>
                <div className="k">Quotes</div>
                <div className="v">{quotePipeline.total}</div>
              </div>
            </div>
          </div>
          <div className="pipe">
            {quotePipeline.rows.map((r) => (
              <button
                key={r.st}
                className={`pipe-row${r.st === "accepted" ? " accent" : ""}`}
                onClick={() => navigate(`/quotes?status=${r.st}`)}
              >
                <span className="nm">{STATUS_LABEL[r.st]}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{ width: w(r.value, quotePipeline.max) }}
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
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Sales Person Leaderboard</h2>
            <p>This month's won revenue &amp; gross profit vs target, plus open pipeline</p>
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
                  <th>Revenue vs target</th>
                  <th>Gross profit vs target</th>
                  <th>Open opps</th>
                  <th>Pipeline value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => {
                  const revPct =
                    r.revTarget > 0 ? (r.revenue / r.revTarget) * 100 : 0;
                  const gpPct = r.gpTarget > 0 ? (r.gp / r.gpTarget) * 100 : 0;
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                      </td>
                      <td>
                        <div className="lb-cell">
                          <span>
                            {money(r.revenue)}
                            {r.revTarget > 0 && (
                              <span className="muted"> / {money(r.revTarget)}</span>
                            )}
                          </span>
                          {r.revTarget > 0 && <MiniBar pct={revPct} />}
                        </div>
                      </td>
                      <td>
                        <div className="lb-cell">
                          <span>
                            {money(r.gp)}
                            {r.gpTarget > 0 && (
                              <span className="muted"> / {money(r.gpTarget)}</span>
                            )}
                          </span>
                          {r.gpTarget > 0 && <MiniBar pct={gpPct} />}
                        </div>
                      </td>
                      <td>{r.openOpps}</td>
                      <td>{money(r.pipelineValue)}</td>
                    </tr>
                  );
                })}
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
                <div className="k">Sent this month</div>
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
  settings: { sales_revenue_target: number; sales_gp_target: number; sales_new_leads_target: number };
  onClose: () => void;
}) {
  const update = useUpdateCompanySettings();
  const { toast, error: toastError } = useToast();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const patch: CompanySettingsPatch = {
      sales_revenue_target: Number(fd.get("sales_revenue_target")) || 0,
      sales_gp_target: Number(fd.get("sales_gp_target")) || 0,
      sales_new_leads_target: Number(fd.get("sales_new_leads_target")) || 0,
    };
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
          <label>Revenue Target (R)</label>
          <input
            name="sales_revenue_target"
            type="number"
            step="0.01"
            defaultValue={settings.sales_revenue_target}
          />
        </div>
        <div className="field">
          <label>Gross Profit Target (R)</label>
          <input
            name="sales_gp_target"
            type="number"
            step="0.01"
            defaultValue={settings.sales_gp_target}
          />
        </div>
        <div className="field">
          <label>New Leads Target</label>
          <input
            name="sales_new_leads_target"
            type="number"
            defaultValue={settings.sales_new_leads_target}
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
