import { useMemo, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { useMyJobs, useMyProfile } from "../../lib/hooks";
import type { Profile } from "../../lib/types";
import { useUpdateCompany, type CompanyDetails, type PortalMe, usePortalMe, usePortalQuotes, useSetGreeting } from "../../lib/portal";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import PortalChatWidget from "./PortalChatWidget";

/* Line icons for the sidebar (24×24, stroke = currentColor). */
const I: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  shipments: (
    <>
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  invoices: (
    <>
      <path d="M12 2v20" />
      <path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.4 5 1.6 5 3.6-2.2 3.5-5 3.5-5-1.4-5-3.4" />
    </>
  ),
  quotes: (
    <>
      <path d="M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9z" />
      <circle cx="8" cy="8" r="1.6" />
    </>
  ),
  party: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 010 7M18 14.8c2 .8 3.2 2.5 3.5 5.2" />
    </>
  ),
  tariff: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  items: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M3 7l9 5 9-5M12 12v10" />
    </>
  ),
  reports: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 21V8l9-5 9 5v13" />
      <path d="M7 21v-8h10v8M7 17h10" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  plane: (
    <path d="M2 16l8-3V6a2 2 0 014 0v7l8 3v2l-8-2v4l3 2v1l-5-1-5 1v-1l3-2v-4l-8 2z" />
  ),
  ship: (
    <>
      <path d="M3 15l2 5h14l2-5-9-3z" />
      <path d="M7 13V7h10v6M12 4v3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
};
export const PortalIcon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {I[name]}
  </svg>
);

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: keyof Profile["portal_permissions"];
  children?: { to: string; label: string }[];
}

const NAV: NavItem[] = [
  { to: "/portal", label: "Dashboard", icon: "dashboard" },
  { to: "/portal/shipments", label: "Shipments", icon: "shipments", permission: "shipments" },
  { to: "/portal/invoices", label: "Invoices", icon: "invoices", permission: "invoices" },
  { to: "/portal/quotes", label: "Quotations", icon: "quotes", permission: "quotes" },
  { to: "/portal/suppliers", label: "Customer Party", icon: "party", permission: "suppliers" },
  { to: "/portal/rates", label: "Tariff Sheet", icon: "tariff", permission: "rates" },
  { to: "/portal/items", label: "Items / SKU", icon: "items", permission: "warehouse" },
  { to: "/portal/reports", label: "Reports", icon: "reports" },
  {
    to: "/portal/warehouse",
    label: "Warehouse",
    icon: "warehouse",
    permission: "warehouse",
    children: [
      { to: "/portal/warehouse?view=overview", label: "Overview" },
      { to: "/portal/warehouse?view=all", label: "Receipt" },
      { to: "/portal/warehouse?view=releases", label: "Release" },
      { to: "/portal/warehouse?view=requests", label: "Release requests" },
      { to: "/portal/warehouse?view=stock", label: "Inventory" },
      { to: "/portal/warehouse?view=statements", label: "Storage statements" },
    ],
  },
];

function isActive(to: string, pathname: string): boolean {
  if (to === "/portal") return pathname === "/portal";
  return pathname === to || pathname.startsWith(to + "/");
}

/**
 * Customer Portal shell (v2, from ExPac's "Customer Portal" deck): a left
 * sidebar with every section, a search bar across the top, and the login's
 * name / company at the foot of the sidebar.
 */
export default function PortalLayout() {
  const { user, signOut } = useAuth();
  const { pathname, search } = useLocation();
  const profileQ = useMyProfile();
  const meQ = usePortalMe();
  const permissions = profileQ.data?.portal_permissions;
  const [menuOpen, setMenuOpen] = useState(false);
  const [greetOpen, setGreetOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Pinned = full sidebar; unpinned = a slim icon rail that opens on hover. Per browser.
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pt-side-pinned") !== "0";
    } catch {
      return true;
    }
  });
  function togglePin() {
    setPinned((p) => {
      try {
        localStorage.setItem("pt-side-pinned", p ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !p;
    });
  }

  // Hidden (not just disabled) when switched off for this login in Customers ›
  // Portal Access; a permission missing on an older login counts as on.
  const nav = NAV.filter(
    (n) => (!n.permission || !permissions || permissions[n.permission] !== false),
  );
  const showChat = permissions?.messaging !== false;
  const name = profileQ.data?.full_name || user?.email || "";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className={`pt-shell${navOpen ? " nav-open" : ""}${pinned ? "" : " unpinned"}`}>
      <aside className="pt-side">
        <div className="pt-brand-row">
          <Link to="/portal" className="pt-brand" onClick={() => setNavOpen(false)}>
            <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac" />
          </Link>
          <button
            type="button"
            className={`pt-pin${pinned ? " on" : ""}`}
            onClick={togglePin}
            title={pinned ? "Unpin the sidebar (shrink to icons)" : "Pin the sidebar open"}
            aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3h6l-1 6 4 4H6l4-4z" />
              <path d="M12 13v8" />
            </svg>
          </button>
        </div>
        <nav className="pt-nav">
          {nav.map((n) => {
            const active = isActive(n.to, pathname);
            return (
              <div key={n.to}>
                <Link to={n.children ? n.children[0].to : n.to} className={`pt-nav-item${active ? " active" : ""}`} onClick={() => setNavOpen(false)}>
                  <PortalIcon name={n.icon} />
                  <span>{n.label}</span>
                  {n.children && <span className="pt-caret">{active ? "▾" : "▸"}</span>}
                </Link>
                {n.children && active && (
                  <div className="pt-subnav">
                    {n.children.map((c) => {
                      const want = new URLSearchParams(c.to.split("?")[1]).get("view");
                      const cur = new URLSearchParams(search).get("view") ?? "overview";
                      return (
                        <Link key={c.to} to={c.to} className={`pt-subnav-item${cur === want ? " active" : ""}`} onClick={() => setNavOpen(false)}>
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="pt-user">
          <button type="button" className="pt-user-btn" onClick={() => setMenuOpen((v) => !v)}>
            <span className="pt-avatar">{initials || "•"}</span>
            <span className="pt-user-text">
              <b>{name}</b>
              <span>{meQ.data?.company ?? ""}</span>
            </span>
          </button>
          {menuOpen && (
            <div className="pt-user-menu">
              {meQ.data?.account_manager && (
                <div className="pt-user-menu-note">
                  Your ExPac contact: <b>{meQ.data.account_manager}</b>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setGreetOpen(true);
                }}
              >
                How should we greet you?
              </button>
              <button type="button" onClick={() => signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="pt-body">
        <header className="pt-top">
          <button type="button" className="pt-burger" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">
            ☰
          </button>
          <PortalSearch />
          <div className="pt-top-right">
            {meQ.data && (
              <button type="button" className="pt-company-btn" onClick={() => setCompanyOpen(true)} title="Your company details, click to update">
                {meQ.data.company} <span aria-hidden>✎</span>
              </button>
            )}
          </div>
        </header>
        <main className="main pt-main">
          <Outlet />
        </main>
      </div>
      {showChat && <PortalChatWidget />}
      {companyOpen && meQ.data && <CompanyDetailsModal me={meQ.data} onClose={() => setCompanyOpen(false)} />}
      {greetOpen && profileQ.data && (
        <GreetingModal profileId={profileQ.data.id} current={profileQ.data.greeting ?? profileQ.data.full_name ?? ""} onClose={() => setGreetOpen(false)} />
      )}
    </div>
  );
}

/** Quick find across the customer's shipments and quotations. */
function PortalSearch() {
  const navigate = useNavigate();
  const jobsQ = useMyJobs();
  const quotesQ = usePortalQuotes();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    const jobs = (jobsQ.data ?? [])
      .filter((j) => [j.reference, j.awb_mbl, j.container_no, j.origin, j.destination].join(" ").toLowerCase().includes(n))
      .slice(0, 6)
      .map((j) => ({ key: `j${j.id}`, label: j.reference, sub: `Shipment · ${j.mode}`, to: `/portal/shipments/${j.id}` }));
    const quotes = (quotesQ.data ?? [])
      .filter((x) => [x.reference, x.customer_reference, x.origin, x.destination, x.commodity].join(" ").toLowerCase().includes(n))
      .slice(0, 6)
      .map((x) => ({ key: `q${x.id}`, label: x.reference, sub: `Quotation · ${x.mode}`, to: `/portal/quotes?open=${x.id}` }));
    return [...jobs, ...quotes];
  }, [q, jobsQ.data, quotesQ.data]);
  return (
    <div className="pt-search">
      <PortalIcon name="search" />
      <input
        value={q}
        placeholder="Search shipments, AWB / B/L, container, quotations…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            navigate(hits[0].to);
            setQ("");
          }
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="pt-search-pop">
          {hits.length === 0 ? (
            <div className="pt-search-empty">Nothing found</div>
          ) : (
            hits.map((h) => (
              <button
                key={h.key}
                type="button"
                onMouseDown={() => {
                  navigate(h.to);
                  setQ("");
                }}
              >
                <b>{h.label}</b>
                <span>{h.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function GreetingModal({ profileId, current, onClose }: { profileId: string; current: string; onClose: () => void }) {
  const [v, setV] = useState(current);
  const save = useSetGreeting();
  const { toast, error } = useToast();
  return (
    <Modal title="How should we greet you?" onClose={onClose}>
      <div className="field">
        <label>Shown as "Good morning, …" / "Good afternoon, …"</label>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Mr Gilbert" autoFocus />
      </div>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { profileId, greeting: v },
              {
                onSuccess: () => {
                  toast("Saved");
                  onClose();
                },
                onError: (e) => error(e.message),
              },
            )
          }
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/** Top-right company name -> the customer's own company details; saving
 *  updates its customer record at ExPac (0145). */
function CompanyDetailsModal({ me, onClose }: { me: PortalMe; onClose: () => void }) {
  const save = useUpdateCompany();
  const { toast, error } = useToast();
  const [v, setV] = useState<CompanyDetails>({
    company: me.company ?? "",
    registration_no: me.registration_no ?? "",
    vat_no: me.vat_no ?? "",
    import_code: me.import_code ?? "",
    email: me.email ?? "",
    company_phone: me.company_phone ?? "",
    contact_mobile: me.contact_mobile ?? "",
    address: me.address ?? "",
    physical_address: me.physical_address ?? "",
  });
  const set = (k: keyof CompanyDetails, x: string) => setV((p) => ({ ...p, [k]: x }));
  const field = (k: keyof CompanyDetails, label: string, type = "text") => (
    <div className="field">
      <label>{label}</label>
      <input type={type} value={(v[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  const area = (k: keyof CompanyDetails, label: string) => (
    <div className="field">
      <label>{label}</label>
      <textarea rows={3} value={(v[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  return (
    <Modal title="Your company details" onClose={onClose} wide>
      <div className="field">
        <label>Company Name *</label>
        <input value={v.company} onChange={(e) => set("company", e.target.value)} autoFocus />
      </div>
      <div className="grid3">
        {field("registration_no", "Registration Number")}
        {field("vat_no", "VAT Number")}
        {field("import_code", "Customs Import Number")}
      </div>
      <div className="grid3">
        {field("email", "Email Address", "email")}
        {field("company_phone", "Tel Number")}
        {field("contact_mobile", "Mobile Number")}
      </div>
      <div className="grid2">
        {area("address", "Company Address")}
        {area("physical_address", "Delivery Address")}
      </div>
      <p className="hint">These details update your customer account with ExPac, they're used on your quotations, documents and invoices.</p>
      <div className="modal-foot-row">
        <button type="button" className="btn outline" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={save.isPending}
          onClick={() => {
            if (!v.company.trim()) return error("Company name is required");
            save.mutate(v, {
              onSuccess: () => {
                toast("Company details updated");
                onClose();
              },
              onError: (e) => error(e.message),
            });
          }}
        >
          {save.isPending ? "Saving…" : "Save details"}
        </button>
      </div>
    </Modal>
  );
}
