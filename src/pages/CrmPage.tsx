import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/common";
import ComingSoonTab from "./crm/ComingSoonTab";
import LeadsPage from "./crm/LeadsPage";
import LeadStatusesPage from "./crm/LeadStatusesPage";
import OpportunitiesTab from "./crm/OpportunitiesTab";
import SalesDashboardTab from "./crm/SalesDashboardTab";

type Tab = "dashboard" | "leads" | "opportunities" | "statuses" | "team" | "templates";

const COPY: Record<Tab, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Sales performance", title: "Sales CRM" },
  leads: { eyebrow: "Prospects", title: "Leads" },
  opportunities: { eyebrow: "Client relationships", title: "Opportunities" },
  statuses: { eyebrow: "Configuration", title: "Lead Statuses" },
  team: { eyebrow: "Configuration", title: "Sales Person" },
  templates: { eyebrow: "Outreach", title: "Templates" },
};

/**
 * Sales CRM — sub-nav lives in the shared top-nav (Layout.tsx), driven by
 * ?tab=. "Opportunities" is the original per-customer pipeline/timeline
 * page, relocated here rather than duplicated.
 */
export default function CrmPage() {
  const [params] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "dashboard";
  const copy = COPY[tab] ?? COPY.dashboard;

  return (
    <>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} />
      {tab === "dashboard" && <SalesDashboardTab />}
      {tab === "leads" && <LeadsPage />}
      {tab === "opportunities" && <OpportunitiesTab />}
      {tab === "statuses" && <LeadStatusesPage />}
      {tab === "team" && (
        <ComingSoonTab
          title="Sales Person"
          body="Per-salesperson targets against their leads/deals — phase 2 of the Sales CRM brief."
        />
      )}
      {tab === "templates" && (
        <ComingSoonTab
          title="Templates"
          body="Reusable outreach message templates — phase 3 of the Sales CRM brief."
        />
      )}
    </>
  );
}
