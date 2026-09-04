import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/ops", label: "Control Tower", end: false },
  { to: "/quotes", label: "Quotations", end: false },
  { to: "/import-vat-duty", label: "Customs Charges", end: false },
  { to: "/jobs", label: "Active Jobs", end: true },
  { to: "/jobs/completed", label: "Completed Jobs", end: false },
  { to: "/clients", label: "Customers", end: false },
  { to: "/suppliers", label: "Shippers", end: false },
  { to: "/agents", label: "Agents", end: false },
  { to: "/transporters", label: "Transporters", end: false },
  { to: "/clearing-agents", label: "Clearing Agents", end: false },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const name =
    (user?.user_metadata?.full_name as string | undefined) || user?.email || "";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-lockup">
            <img
              src="/ExPac-Final_Maybe-300x106.png"
              alt="ExPac Motion"
              className="brand-logo"
            />
            <div className="brand-name" aria-label="Forwarding">
              {"FORWARDING".split("").map((ch, i) => (
                <span key={i}>{ch}</span>
              ))}
            </div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <span className="nav-dot" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="footer-user">
          <div className="who">{name}</div>
          <button className="link-btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
