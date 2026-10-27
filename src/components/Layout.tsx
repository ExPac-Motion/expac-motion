import { useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { alertsOn, notifyNewMail } from "../lib/inboxAlerts";
import { useAuth } from "../auth/AuthProvider";
import { isVaultOwner } from "../lib/flags";
import { useQueryClient } from "@tanstack/react-query";
import { previewActive, setPortalPreview } from "../lib/db";
import { useCan, useInboxUnread, useMyProfile, useNavCounts } from "../lib/hooks";
import type { PermKey } from "../lib/permissions";
import GlobalSearch from "./GlobalSearch";
import NotificationsBell from "./NotificationsBell";

interface SubLink {
  to: string;
  label: string;
}
interface NavModule {
  to: string;
  label: string;
  children?: SubLink[];
}

/**
 * Primary top-nav modules. A module with `children` gets a secondary sub-nav
 * row underneath the top bar whenever it (or one of its children) is active.
 * Control Tower's children are query-string tabs on the same route, they
 * used to be an in-page tab bar (OpsControlTowerPage) but now live here so
 * every module's sub-pages sit in the same place.
 */
const NAV: NavModule[] = [
  { to: "/", label: "Dashboard" },
  {
    to: "/ops",
    label: "Control Tower",
    children: [
      { to: "/ops?tab=tasks", label: "Tasks & Notes" },
      { to: "/ops?tab=notifications", label: "Notifications" },
      { to: "/ops?tab=calendar", label: "Calendar" },
      { to: "/ops?tab=tracking", label: "Live Tracking" },
      { to: "/ops?tab=docvault", label: "Document Vault" },
      { to: "/ops?tab=worldclock", label: "World Clock" },
    ],
  },
  {
    to: "/jobs",
    label: "Shipments",
    children: [
      { to: "/jobs", label: "Active Shipments" },
      { to: "/jobs?mode=air", label: "Air Freight" },
      { to: "/jobs?mode=courier", label: "Courier Express" },
      { to: "/jobs?mode=sea", label: "Sea Freight" },
      { to: "/jobs?mode=road", label: "Road Freight" },
      { to: "/jobs/completed", label: "Completed Shipments" },
      { to: "/jobs/masters", label: "Masters & Houses" },
    ],
  },
  {
    to: "/quotes",
    label: "Quotations",
    children: [
      { to: "/quotes", label: "All Quotes" },
      { to: "/quotes?status=open", label: "New Lead" },
      { to: "/quotes?status=sent", label: "Quote Sent" },
      { to: "/quotes?status=accepted", label: "Quote Accepted" },
      { to: "/quotes?status=completed", label: "Completed" },
      { to: "/quotes?status=lost", label: "Not Proceeding" },
    ],
  },
  {
    to: "/wms",
    label: "Motion WMS",
    children: [
      { to: "/wms", label: "Dashboard" },
      { to: "/wms?tab=reports", label: "Reports" },
      { to: "/wms?tab=receipt", label: "Warehouse Receipt" },
      { to: "/jobs/masters", label: "Masters & Houses" },
      { to: "/wms?tab=movements", label: "Warehouse Movements" },
      { to: "/wms?tab=release", label: "Warehouse Release" },
      { to: "/wms?tab=inventory", label: "Warehouse Inventory" },
      { to: "/wms?tab=billing", label: "Warehouse Billing (Storage)" },
      { to: "/wms?tab=count", label: "Cycle Count" },
      { to: "/wms?tab=settings", label: "Settings" },
    ],
  },
  { to: "/import-vat-duty", label: "Customs Charges" },
  { to: "/rates", label: "Rates & Tariff" },
  {
    to: "/clients",
    label: "Customers",
    children: [
      { to: "/clients", label: "All Customers" },
      // Shippers belong to a customer (0142), the full list lives here now.
      { to: "/suppliers", label: "Shippers" },
      { to: "/clients?tab=portal-access", label: "Portal Access" },
    ],
  },
  {
    to: "/agents",
    label: "Vendors",
    children: [
      { to: "/agents", label: "Agents" },
      { to: "/transporters", label: "Transporters" },
      { to: "/clearing-agents", label: "Clearing Agents" },
      { to: "/destination-agents", label: "Destination Agents" },
    ],
  },
  {
    to: "/crm",
    label: "Sales CRM",
    children: [
      { to: "/crm", label: "Dashboard" },
      { to: "/crm?tab=inbox", label: "Inbox" },
      { to: "/crm?tab=messages", label: "Customer Messages" },
      { to: "/crm?tab=trends", label: "Trends" },
      { to: "/crm?tab=leads", label: "Leads" },
      { to: "/crm?tab=statuses", label: "Lead Statuses" },
      { to: "/crm?tab=sources", label: "Lead Sources" },
      { to: "/crm?tab=team", label: "Sales Person" },
      { to: "/crm?tab=templates", label: "Templates" },
      { to: "/crm?tab=campaigns", label: "Campaigns" },
      { to: "/crm?tab=followups", label: "Workflows" },
      { to: "/crm?tab=forms", label: "Forms" },
      { to: "/crm?tab=media", label: "Media" },
    ],
  },
];

function basePath(to: string): string {
  return to.split("?")[0];
}
function pathMatches(base: string, pathname: string): boolean {
  return base === "/"
    ? pathname === "/"
    : pathname === base || pathname.startsWith(base + "/");
}
function isModuleActive(mod: NavModule, pathname: string): boolean {
  if (pathMatches(basePath(mod.to), pathname)) return true;
  return (mod.children ?? []).some((c) => pathMatches(basePath(c.to), pathname));
}
/** Query-string-aware active check for a sub-link (Control Tower's ?tab=). */
function isSubActive(sub: SubLink, pathname: string, search: string): boolean {
  const [base, qs] = sub.to.split("?");
  if (pathname !== base) return false;
  if (!qs) return search === "";
  const want = new URLSearchParams(qs);
  const cur = new URLSearchParams(search);
  for (const [k, v] of want) {
    const curVal = cur.get(k) ?? (k === "tab" ? "tasks" : "");
    if (curVal !== v) return false;
  }
  return true;
}

const Icon = {
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 01-4 0v-.09A1.7 1.7 0 008.9 19.36a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.04H3a2 2 0 010-4h.09A1.7 1.7 0 004.64 8.9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34H9a1.7 1.7 0 001.04-1.56V3a2 2 0 014 0v.09a1.7 1.7 0 001.04 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9a1.7 1.7 0 001.56 1.04H21a2 2 0 010 4h-.09A1.7 1.7 0 0019.4 15z" />
    </svg>
  ),
};

export default function Layout() {
  const { user, signOut } = useAuth();
  const { pathname, search } = useLocation();
  const profileQ = useMyProfile();
  const isAdmin = profileQ.data?.role === "admin";
  const can = useCan();
  // The Team name (profiles.full_name) first: the sign-up name stored on the
  // login is never updated, so it can be someone else's (e.g. whoever created it).
  const name =
    profileQ.data?.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email ||
    "";

  // The Personal Vault tab is only wired into Control Tower for its owner.
  let nav: NavModule[] = isVaultOwner(user?.email)
    ? NAV.map((m) =>
        m.to === "/ops"
          ? {
              ...m,
              children: [
                ...(m.children ?? []),
                { to: "/ops?tab=vault", label: "Personal Vault" },
              ],
            }
          : m,
      )
    : NAV;

  // Portal Access manages other logins' roles/permissions/passwords,
  // admin-only, same as the RPCs it calls (0091_role_model_v2.sql).
  if (!isAdmin) {
    nav = nav.map((m) =>
      m.to === "/clients"
        ? { ...m, children: m.children?.filter((c) => !c.to.includes("portal-access")) }
        : m,
    );
  }
  // Role permissions (0131): Rates & Tariff needs "rates" (the tables are
  // locked to admin / rates permission in the database); the CRM Dashboard
  // and Trends (sales performance, financials) need "crm".
  // Each Motion area (0133) is its own permission.
  const AREA: Record<string, PermKey> = {
    "/ops": "ops",
    "/jobs": "shipments",
    "/quotes": "quotes",
    "/wms": "warehouse",
    "/import-vat-duty": "customs",
    "/clients": "customers",
    "/agents": "suppliers",
    "/rates": "rates",
  };
  nav = nav.filter((m) => !AREA[m.to] || can(AREA[m.to]));
  // Sales CRM: Dashboard / Trends need "crm", Inbox "inbox", every other tab "leads".
  const crmTab = (to: string) => to === "/crm" || to.includes("tab=trends");
  nav = nav
    .map((m) => {
      if (m.to !== "/crm") return m;
      const children = m.children?.filter((c) =>
        c.to.includes("tab=inbox") ? can("inbox") : c.to.includes("tab=messages") ? can("customers") : crmTab(c.to) ? can("crm") : can("leads"),
      );
      return { ...m, to: children?.[0]?.to ?? m.to, children };
    })
    .filter((m) => m.to !== "/crm" && !m.to.startsWith("/crm?") ? true : (m.children?.length ?? 0) > 0);

  const activeModule = nav.find((m) => isModuleActive(m, pathname));

  // Name the browser tab after the open section ("Quotations - ExPac Motion"),
  // so several Motion tabs side by side can be told apart.
  const section = pathname.startsWith("/settings") ? "Settings" : activeModule?.label;
  useEffect(() => {
    document.title = section ? `${section} - ExPac Motion` : "ExPac Motion";
    return () => {
      document.title = "ExPac Motion";
    };
  }, [section]);

  // Unread Inbox mail: a count on Sales CRM / Inbox, and a desktop alert
  // (when switched on in the Inbox) for mail that arrives while you work.
  const navigate = useNavigate();
  const unreadQ = useInboxUnread(can("inbox"));
  const unread = unreadQ.data?.length ?? 0;
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const list = unreadQ.data;
    if (!list) return;
    // First load: what's already waiting raises no alerts.
    if (!known.current) {
      known.current = new Set(list.map((m) => m.id));
      return;
    }
    const seen = known.current;
    const fresh = list.filter((m) => !seen.has(m.id));
    for (const m of fresh) seen.add(m.id);
    if (!fresh.length || !alertsOn()) return;
    // Not while the Inbox is on screen, and not for older mail the history sync brings in.
    if (document.visibilityState === "visible" && pathname === "/crm" && search.includes("tab=inbox")) return;
    const recent = fresh.filter((m) => Date.now() - new Date(m.sent_at).getTime() < 2 * 3_600_000);
    for (const m of recent.slice(0, 3)) notifyNewMail(m, () => navigate("/crm?tab=inbox"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadQ.data]);
  const badge = (n: number) => (n > 0 ? <span className="nav-count">{n > 999 ? "999+" : n}</span> : null);

  // Work waiting in each area (0184), refreshed every minute and whenever you
  // move to another page (so a count drops soon after you deal with something).
  const navQ = useNavCounts();
  const { refetch: refetchCounts } = navQ;
  useEffect(() => {
    void refetchCounts();
  }, [pathname, search, refetchCounts]);
  const nc = navQ.data;
  /** The count on one menu link. */
  const linkCount = (to: string): number => {
    if (to.includes("tab=inbox")) return unread;
    if (!nc) return 0;
    const byLink: Record<string, number> = {
      "/jobs": nc.jobs_active,
      "/jobs?mode=air": nc.jobs_air,
      "/jobs?mode=courier": nc.jobs_courier,
      "/jobs?mode=sea": nc.jobs_sea,
      "/jobs?mode=road": nc.jobs_road,
      "/quotes?status=open": nc.quotes_open,
      "/quotes?status=sent": nc.quotes_sent,
      "/quotes?status=accepted": nc.quotes_accepted,
      "/ops?tab=tasks": nc.tasks_open,
      "/crm?tab=messages": nc.chat_unread,
      "/clients?tab=portal-access": nc.portal_pending ?? 0,
      "/crm?tab=leads": nc.leads_total ?? 0,
      "/clients": nc.clients_total ?? 0,
      "/suppliers": nc.suppliers_total ?? 0,
    };
    return byLink[to] ?? 0;
  };

  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>

        <nav className="topbar-primary">
          {nav.map((m) => (
            <Link
              key={m.label}
              to={m.to}
              className={`topbar-tab${activeModule === m ? " active" : ""}`}
            >
              {/* Counts sit on the sub-nav links only, not the top tabs. */}
              {m.label}
            </Link>
          ))}
        </nav>

        <div className="topbar-utils">
          <GlobalSearch />
          <NotificationsBell />
          {can("settings") && (
            <Link
              to="/settings"
              className={`icon-btn${pathname.startsWith("/settings") ? " active" : ""}`}
              title="Settings"
              aria-label="Settings"
            >
              {Icon.gear}
            </Link>
          )}
          <div className="topbar-account">
            <span className="who">{name}</span>
            <button className="link-btn" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {activeModule?.children && (
        <nav className="subnav">
          {activeModule.children.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className={`subnav-tab${isSubActive(c, pathname, search) ? " active" : ""}`}
            >
              {c.label}
              {badge(linkCount(c.to))}
            </Link>
          ))}
        </nav>
      )}

      <main className={`main${activeModule?.children ? " has-subnav" : ""}`}>
        {previewActive(profileQ.data) && <MotionPreviewBanner />}
        <Outlet />
      </main>
    </div>
  );
}

/**
 * An Admin's "View portal as customer" preview (0167 / 0169) turns off staff
 * access for that login everywhere, so Motion shows zeros and empty pages
 * until it ends. Say so here, with the way out, instead of looking broken.
 */
function MotionPreviewBanner() {
  const qc = useQueryClient();
  async function exit() {
    try {
      await setPortalPreview(null);
    } finally {
      qc.clear();
      window.location.reload();
    }
  }
  return (
    <div className="pt-preview-banner" role="status">
      <span>
        👁 <b>Customer portal preview is running</b> on your login, so Motion shows no data (zeros,
        empty lists, settings errors) until it ends. Ends automatically after 2 hours.
      </span>
      <button type="button" className="btn outline btn-sm" onClick={() => void exit()}>
        Exit preview
      </button>
    </div>
  );
}
