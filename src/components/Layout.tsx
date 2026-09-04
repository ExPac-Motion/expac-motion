import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

interface NavLeaf {
  to: string;
  label: string;
  end?: boolean;
}
interface NavGroup {
  label: string;
  children: NavLeaf[];
}
type NavItem = NavLeaf | NavGroup;

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/ops", label: "Control Tower" },
  { to: "/quotes", label: "Quotations" },
  { to: "/import-vat-duty", label: "Customs Charges" },
  { to: "/jobs", label: "Active Shipments", end: true },
  { to: "/jobs/completed", label: "Completed Shipments" },
  { to: "/clients", label: "Customers" },
  {
    label: "Suppliers",
    children: [
      { to: "/suppliers", label: "Shippers" },
      { to: "/agents", label: "Agents" },
      { to: "/transporters", label: "Transporters" },
      { to: "/clearing-agents", label: "Clearing Agents" },
    ],
  },
];

function isGroup(n: NavItem): n is NavGroup {
  return "children" in n;
}

function Leaf({ to, label, end }: NavLeaf) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => (isActive ? "active" : "")}
    >
      <span className="nav-dot" />
      {label}
    </NavLink>
  );
}

function Group({ group }: { group: NavGroup }) {
  const { pathname } = useLocation();
  const hasActiveChild = group.children.some((c) => pathname.startsWith(c.to));
  const [open, setOpen] = useState(hasActiveChild);
  const show = open || hasActiveChild;

  return (
    <div className={`nav-group${show ? " open" : ""}`}>
      <button
        className="nav-group-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={show}
      >
        <span className="nav-dot" />
        {group.label}
        <span className="nav-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {show && (
        <div className="nav-children">
          {group.children.map((c) => (
            <Leaf key={c.to} {...c} />
          ))}
        </div>
      )}
    </div>
  );
}

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
          {NAV.map((n) =>
            isGroup(n) ? (
              <Group key={n.label} group={n} />
            ) : (
              <Leaf key={n.to} {...n} />
            ),
          )}
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
