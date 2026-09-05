import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Modal from "../../components/Modal";
import { ErrorNote, Loading } from "../../components/common";
import { useToast } from "../../components/Toast";
import {
  useCompanySettings,
  useLeads,
  useQuotes,
  useUpdateCompanySettings,
} from "../../lib/hooks";
import { chargeTotals, fxOf } from "../../lib/calc";
import { money } from "../../lib/format";
import type { CompanySettingsPatch } from "../../lib/types";

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

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
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
};

export default function SalesDashboardTab() {
  const quotesQ = useQuotes();
  const leadsQ = useLeads();
  const settingsQ = useCompanySettings();
  const [editingTargets, setEditingTargets] = useState(false);

  const stats = useMemo(() => {
    const quotes = quotesQ.data ?? [];
    const leads = leadsQ.data ?? [];
    const acceptedThisMonth = quotes.filter(
      (q) => q.status === "accepted" && isThisMonth(q.accepted_at),
    );
    const totals = acceptedThisMonth.map((q) => chargeTotals(q.quote_lines, fxOf(q)));
    const revenue = totals.reduce((s, t) => s + t.sell, 0);
    const grossProfit = totals.reduce((s, t) => s + t.gp, 0);
    const openEnquiries = quotes.filter(
      (q) => q.status === "open" || q.status === "sent",
    ).length;
    const newLeads = leads.filter((l) => isThisMonth(l.created_at)).length;
    return { revenue, grossProfit, openEnquiries, newLeads };
  }, [quotesQ.data, leadsQ.data]);

  const isLoading = quotesQ.isLoading || leadsQ.isLoading || settingsQ.isLoading;
  const isError = quotesQ.isError || leadsQ.isError || settingsQ.isError;

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
          This calendar month, computed live from your quotes and leads.
        </p>
        <button className="btn outline" onClick={() => setEditingTargets(true)}>
          Edit Targets
        </button>
      </div>

      <div className="dash-kpis">
        <SalesKpi
          icon={Icon.revenue}
          label="Revenue"
          value={money(stats.revenue)}
          actual={stats.revenue}
          target={settings.sales_revenue_target}
          targetLabel={money(settings.sales_revenue_target)}
        />
        <SalesKpi
          icon={Icon.profit}
          label="Gross Profit"
          value={money(stats.grossProfit)}
          actual={stats.grossProfit}
          target={settings.sales_gp_target}
          targetLabel={money(settings.sales_gp_target)}
        />
        <SalesKpi
          icon={Icon.leads}
          label="New Leads"
          value={String(stats.newLeads)}
          actual={stats.newLeads}
          target={settings.sales_new_leads_target}
          targetLabel={String(settings.sales_new_leads_target)}
        />
        <div className="kpi static">
          <div className="kpi-top">
            <span className="kpi-icon">{Icon.inbox}</span>
            <span className="kpi-label">Open Enquiries</span>
          </div>
          <div className="kpi-value">{stats.openEnquiries}</div>
          <div className="kpi-foot">
            <span>Quotes currently Open or Sent</span>
          </div>
        </div>
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
