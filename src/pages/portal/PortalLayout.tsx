import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useMyProfile } from "../../lib/hooks";
import type { Profile } from "../../lib/types";
import PortalChatWidget from "./PortalChatWidget";

const NAV: {
  to: string;
  label: string;
  permission?: keyof Profile["portal_permissions"];
}[] = [
  { to: "/portal", label: "Dashboard" },
  { to: "/portal/shipments", label: "Shipments", permission: "shipments" },
  { to: "/portal/quotes", label: "Quotations", permission: "quotes" },
  { to: "/portal/invoices", label: "Invoices", permission: "invoices" },
  { to: "/portal/suppliers", label: "Customer Party", permission: "suppliers" },
  { to: "/portal/rates", label: "Tariff Sheet", permission: "rates" },
];

function isActive(to: string, pathname: string): boolean {
  if (to === "/portal") return pathname === "/portal";
  return pathname === to || pathname.startsWith(to + "/");
}

export default function PortalLayout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const profileQ = useMyProfile();
  const permissions = profileQ.data?.portal_permissions;

  // Dashboard has no toggle — always shown. Every other tab is hidden
  // (not just disabled) when an admin has turned it off for this login,
  // set from Customers > Portal Access.
  const nav = NAV.filter(
    (n) => !n.permission || !permissions || permissions[n.permission],
  );
  const showChat = permissions?.messaging !== false;

  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/portal" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>
        <nav className="topbar-primary">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`topbar-tab${isActive(n.to, pathname) ? " active" : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-utils">
          <div className="topbar-account">
            <span className="who">{user?.email}</span>
            <button className="link-btn" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      {showChat && <PortalChatWidget />}
    </div>
  );
}
