import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

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
 * Control Tower's children are query-string tabs on the same route — they
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
      { to: "/ops?tab=calendar", label: "Calendar" },
      { to: "/ops?tab=tracking", label: "Live Tracking" },
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
    ],
  },
  {
    to: "/quotes",
    label: "Quotations",
    children: [
      { to: "/quotes?status=open", label: "Open Quotes" },
      { to: "/quotes?status=sent", label: "Sent Quotes" },
      { to: "/quotes?status=accepted", label: "Accepted Quotes" },
      { to: "/quotes?status=lost", label: "Lost Quotes" },
      { to: "/quotes", label: "All Quotes" },
    ],
  },
  { to: "/import-vat-duty", label: "Customs Charges" },
  { to: "/clients", label: "Customers" },
  { to: "/crm", label: "CRM" },
  {
    to: "/suppliers",
    label: "Suppliers",
    children: [
      { to: "/suppliers", label: "Shippers" },
      { to: "/agents", label: "Agents" },
      { to: "/transporters", label: "Transporters" },
      { to: "/clearing-agents", label: "Clearing Agents" },
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
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 21a2 2 0 004 0" />
    </svg>
  ),
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
  const name =
    (user?.user_metadata?.full_name as string | undefined) || user?.email || "";

  const activeModule = NAV.find((m) => isModuleActive(m, pathname));

  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>

        <nav className="topbar-primary">
          {NAV.map((m) => (
            <Link
              key={m.label}
              to={m.to}
              className={`topbar-tab${activeModule === m ? " active" : ""}`}
            >
              {m.label}
            </Link>
          ))}
        </nav>

        <div className="topbar-utils">
          <button
            className="icon-btn"
            title="Search (coming soon)"
            aria-label="Search"
            disabled
          >
            {Icon.search}
          </button>
          <button
            className="icon-btn"
            title="Notifications (coming soon)"
            aria-label="Notifications"
            disabled
          >
            {Icon.bell}
          </button>
          <Link
            to="/settings"
            className={`icon-btn${pathname.startsWith("/settings") ? " active" : ""}`}
            title="Settings"
            aria-label="Settings"
          >
            {Icon.gear}
          </Link>
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
            </Link>
          ))}
        </nav>
      )}

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
