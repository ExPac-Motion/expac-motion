import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import PortalChatWidget from "./PortalChatWidget";

const NAV = [
  { to: "/portal", label: "Dashboard" },
  { to: "/portal/shipments", label: "Shipments" },
  { to: "/portal/quotes", label: "Quotations" },
  { to: "/portal/invoices", label: "Invoices" },
  { to: "/portal/suppliers", label: "Customer Party" },
  { to: "/portal/rates", label: "Tariff Sheet" },
];

function isActive(to: string, pathname: string): boolean {
  if (to === "/portal") return pathname === "/portal";
  return pathname === to || pathname.startsWith(to + "/");
}

export default function PortalLayout() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/portal" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>
        <nav className="topbar-primary">
          {NAV.map((n) => (
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
      <PortalChatWidget />
    </div>
  );
}
