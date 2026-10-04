import { Navigate, useSearchParams } from "react-router-dom";
import { useCan } from "../lib/hooks";
import { PageHeader } from "../components/common";
import CampaignsPage from "./crm/CampaignsPage";
import FollowUpsPage from "./crm/FollowUpsPage";
import FormsPage from "./crm/FormsPage";
import LeadsPage from "./crm/LeadsPage";
import MediaPage from "./crm/MediaPage";
import LeadStatusesPage from "./crm/LeadStatusesPage";
import LeadSourcesPage from "./crm/LeadSourcesPage";
import OpportunitiesTab from "./crm/OpportunitiesTab";
import SalesDashboardTab from "./crm/SalesDashboardTab";
import SalesPersonPage from "./crm/SalesPersonPage";
import TemplatesPage from "./crm/TemplatesPage";
import TrendsTab from "./crm/TrendsTab";

type Tab =
  | "dashboard"
  | "trends"
  | "leads"
  | "opportunities"
  | "statuses"
  | "sources"
  | "team"
  | "templates"
  | "campaigns"
  | "followups"
  | "forms"
  | "media";

const COPY: Record<Tab, { eyebrow: string; title: string }> = {
  dashboard: { eyebrow: "Sales performance", title: "Sales CRM" },
  trends: { eyebrow: "Sales performance", title: "Trends" },
  leads: { eyebrow: "Prospects", title: "Leads" },
  opportunities: { eyebrow: "Client relationships", title: "Opportunities" },
  statuses: { eyebrow: "Configuration", title: "Lead Statuses" },
  sources: { eyebrow: "Configuration", title: "Lead Sources" },
  team: { eyebrow: "Configuration", title: "Sales Person" },
  templates: { eyebrow: "Outreach", title: "Templates" },
  campaigns: { eyebrow: "Outreach", title: "Campaigns" },
  followups: { eyebrow: "Outreach", title: "Workflows" },
  forms: { eyebrow: "Outreach", title: "Forms" },
  media: { eyebrow: "Outreach", title: "Media" },
};

/**
 * Sales CRM — sub-nav lives in the shared top-nav (Layout.tsx), driven by
 * ?tab=. "Opportunities" is the original per-customer pipeline/timeline
 * page, relocated here rather than duplicated.
 */
export default function CrmPage() {
  const [params] = useSearchParams();
  const can = useCan();
  const asked = (params.get("tab") as Tab) || "dashboard";
  // Dashboard / Trends (sales performance, financials) need "crm" (0131);
  // every other tab needs "leads" (0133).
  const allowed = (t: Tab) => (t === "dashboard" || t === "trends" ? can("crm") : can("leads"));
  const tab: Tab | null = allowed(asked)
    ? asked
    : can("leads")
      ? "leads"
      : can("crm")
        ? "dashboard"
        : null;
  if (!tab) return <Navigate to="/" replace />;
  const copy = COPY[tab] ?? COPY.dashboard;

  return (
    <>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} />
      {tab === "dashboard" && <SalesDashboardTab />}
      {tab === "trends" && <TrendsTab />}
      {tab === "leads" && <LeadsPage />}
      {tab === "opportunities" && <OpportunitiesTab />}
      {tab === "statuses" && <LeadStatusesPage />}
      {tab === "sources" && <LeadSourcesPage />}
      {tab === "team" && <SalesPersonPage />}
      {tab === "templates" && <TemplatesPage />}
      {tab === "campaigns" && <CampaignsPage />}
      {tab === "followups" && <FollowUpsPage />}
      {tab === "forms" && <FormsPage />}
      {tab === "media" && <MediaPage />}
    </>
  );
}
