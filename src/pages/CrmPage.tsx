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
import SalesDashboardTab from "./crm/SalesDashboardTab";
import InboxTab from "./crm/InboxTab";
import CustomerMessagesTab from "./crm/CustomerMessagesTab";
import SalesPersonPage from "./crm/SalesPersonPage";
import TemplatesPage from "./crm/TemplatesPage";
import TrendsTab from "./crm/TrendsTab";

type Tab =
  | "dashboard"
  | "inbox"
  | "messages"
  | "trends"
  | "leads"
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
  inbox: { eyebrow: "support@expac.co.za", title: "Inbox" },
  messages: { eyebrow: "Customer Portal chat", title: "Customer Messages" },
  trends: { eyebrow: "Sales performance", title: "Trends" },
  leads: { eyebrow: "Prospects", title: "Leads" },
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
 * Sales CRM, sub-nav lives in the shared top-nav (Layout.tsx), driven by
 * ?tab=.
 */
export default function CrmPage() {
  const [params] = useSearchParams();
  const can = useCan();
  const askedRaw = params.get("tab");
  // Opportunities were retired (0172): quotes are the pipeline now.
  if (askedRaw === "opportunities") return <Navigate to="/quotes" replace />;
  const asked = (askedRaw as Tab) || "dashboard";
  // Dashboard / Trends (sales performance, financials) need "crm" (0131);
  // every other tab needs "leads" (0133).
  const allowed = (t: Tab) =>
    t === "inbox" ? can("inbox") : t === "messages" ? can("customers") : t === "dashboard" || t === "trends" ? can("crm") : can("leads");
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
      {tab === "inbox" && <InboxTab />}
      {tab === "messages" && <CustomerMessagesTab />}
      {tab === "trends" && <TrendsTab />}
      {tab === "leads" && <LeadsPage />}
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
