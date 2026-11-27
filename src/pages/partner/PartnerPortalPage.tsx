// Partner portal (migration 0121): an agent / transporter / clearing agent /
// destination agent login. Same sidebar shell as the customer portal
// (pt-* classes, PortalLayout), with real routes under /partner so refresh,
// back and shared links work. The database only ever returns this partner's
// own shipments, RFQs and rate sheets (RLS / SECURITY DEFINER RPCs).
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNote, Loading, PageHeader } from "../../components/common";
import { useCan, useMyPartner } from "../../lib/hooks";
import { updateMyCoverage } from "../../lib/db";
import { useToast } from "../../components/Toast";
import { CoverageEditor, CoverageView, coverageOf, type Coverage } from "../partners/PartnerCoverage";
import type { MyPartner } from "../../lib/types";
import { PARTNER_LABEL } from "../../lib/tariff";
import { usePartnerRfqs, usePartnerShipments } from "../../lib/partnerShipments";
import PartnerRateSheets from "../partners/PartnerRateSheets";
import BrokerDesk from "./BrokerDesk";
import PartnerInvoices from "./PartnerInvoices";
import { usePartnerInvoices } from "../../lib/partnerInvoices";
import PartnerShipments from "./PartnerShipments";
import { PartnerDashboard, PartnerQuotes, PartnerTracking } from "./PartnerHome";
import { PortalIcon } from "../portal/PortalLayout";

interface PartnerCtx {
  me: MyPartner;
  can: ReturnType<typeof useCan>;
}
const usePartnerCtx = () => useOutletContext<PartnerCtx>();

type Tab = "shipments" | "tracking" | "quotes";
const TAB_PATH: Record<Tab, string> = {
  shipments: "/partner/shipments",
  tracking: "/partner/tracking",
  quotes: "/partner/quotes",
};

/** The partner's own coverage, editable with the edit_coverage permission. */
function MyCoverage({ me, canEdit }: { me: MyPartner; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast, error } = useToast();
  const [editing, setEditing] = useState<Coverage | null>(null);
  const [saving, setSaving] = useState(false);
  const current = coverageOf(me);

  if (!editing)
    return (
      <>
        <CoverageView value={current} />
        {canEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn outline" onClick={() => setEditing(current)}>
              Edit coverage
            </button>
          </div>
        )}
      </>
    );
  return (
    <>
      <CoverageEditor value={editing} onChange={setEditing} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn outline" onClick={() => setEditing(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await updateMyCoverage(editing);
              qc.invalidateQueries({ queryKey: ["my_partner"] });
              setEditing(null);
              toast("Coverage saved");
            } catch (e) {
              error(e instanceof Error ? e.message : "Could not save your coverage");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save coverage"}
        </button>
      </div>
    </>
  );
}

/* ---------------- Route pages ---------------- */

export function PartnerDashboardRoute() {
  const { me } = usePartnerCtx();
  const navigate = useNavigate();
  return (
    <PartnerDashboard
      kind={me.partner_kind}
      onOpen={(id) => navigate(`/partner/shipments/${id}`)}
      onTab={(t) => navigate(TAB_PATH[t])}
    />
  );
}

export function PartnerShipmentsRoute() {
  const { me } = usePartnerCtx();
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <PartnerShipments
      kind={me.partner_kind}
      openId={id ?? null}
      onOpen={(next) => navigate(next ? `/partner/shipments/${next}` : "/partner/shipments")}
    />
  );
}

export function PartnerTrackingRoute() {
  const { me } = usePartnerCtx();
  const navigate = useNavigate();
  return <PartnerTracking kind={me.partner_kind} onOpen={(id) => navigate(`/partner/shipments/${id}`)} />;
}

export function PartnerInvoicesRoute() {
  const { me } = usePartnerCtx();
  return <PartnerInvoices company={me.company || "Your company"} />;
}

export function PartnerQuotesRoute() {
  return <PartnerQuotes />;
}

export function PartnerCustomsRoute() {
  const { me } = usePartnerCtx();
  if (me.partner_kind !== "clearing_agent") return <p className="hint">Customs files are for clearing agents.</p>;
  return (
    <>
      <PageHeader eyebrow="Instructed by ExPac" title="Customs Files" />
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Customs files ExPac Forwarding has instructed you to clear: the shipment, importer and documents, ready to
        download. Update each file as you go (entry lodged, queries, cleared) and upload the release note; ExPac sees
        every step.
      </p>
      <BrokerDesk />
    </>
  );
}

export function PartnerRatesRoute() {
  const { me, can } = usePartnerCtx();
  return (
    <>
      <PageHeader eyebrow="Your rates to ExPac" title="Rate Sheets & Coverage" />
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Keep your air and sea freight rates to ExPac Forwarding up to date, one rate sheet per mode and trade route,
        using ExPac's charge codes. Update them whenever your rates change (at least weekly); ExPac sees each change.
      </p>
      <div className="panel">
        <PartnerRateSheets
          kind={me.partner_kind}
          partnerId={me.partner_id}
          partnerName={me.company || "your company"}
          modes={me.modes}
          countries={me.countries}
          canDelete={can("delete_sheets")}
          showHistory={can("see_history")}
        />
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <MyCoverage me={me} canEdit={can("edit_coverage")} />
      </div>
    </>
  );
}

/* ---------------- Shell ---------------- */

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}

function isActive(to: string, pathname: string): boolean {
  if (to === "/partner") return pathname === "/partner" || pathname === "/partner/";
  return pathname === to || pathname.startsWith(to + "/");
}

/** Sidebar shell for every partner page (route element for /partner/*). */
export default function PartnerPortalPage() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const q = useMyPartner();
  const me = q.data;
  const can = useCan();
  const shipmentsQ = usePartnerShipments(!!me);
  const rfqsQ = usePartnerRfqs(!!me);
  const invoicesQ = usePartnerInvoices(!!me);
  const queried = (invoicesQ.data ?? []).filter((i) => i.status === "queried").length;
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const todo = (shipmentsQ.data ?? []).filter((r) => !r.completed && (r.action || r.acceptance === "pending")).length;
  const openRfqs = (rfqsQ.data ?? []).filter((r) => r.status === "awaiting").length;
  const nav: NavItem[] = [
    { to: "/partner", label: "Dashboard", icon: "dashboard" },
    { to: "/partner/shipments", label: "Shipments", icon: "shipments", badge: todo },
    { to: "/partner/tracking", label: "Tracking", icon: "ship" },
    { to: "/partner/quotes", label: "Quotes", icon: "quotes", badge: openRfqs },
    { to: "/partner/invoices", label: "Invoices", icon: "invoices", badge: queried },
    ...(me?.partner_kind === "clearing_agent"
      ? [{ to: "/partner/customs", label: "Customs Files", icon: "reports" }]
      : []),
    { to: "/partner/rates", label: "Rate Sheets", icon: "tariff" },
  ];

  const email = user?.email ?? "";
  const initials = (me?.company || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className={`pt-shell${navOpen ? " nav-open" : ""}`}>
      <aside className="pt-side">
        <div className="pt-brand-row">
          <Link to="/partner" className="pt-brand" onClick={() => setNavOpen(false)}>
            <img className="pt-brand-full" src="/ExPac-Final_Maybe-300x106.png" alt="ExPac" />
          </Link>
        </div>
        <nav className="pt-nav">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`pt-nav-item${isActive(n.to, pathname) ? " active" : ""}`}
              onClick={() => setNavOpen(false)}
            >
              <PortalIcon name={n.icon} />
              <span>{n.label}</span>
              {!!n.badge && <span className="pp-nav-badge">{n.badge}</span>}
            </Link>
          ))}
        </nav>
        <div className="pt-user">
          <button type="button" className="pt-user-btn" onClick={() => setMenuOpen((v) => !v)}>
            <span className="pt-avatar">{initials || "•"}</span>
            <span className="pt-user-text">
              <b>{me?.company || "Partner"}</b>
              <span>{email}</span>
            </span>
          </button>
          {menuOpen && (
            <div className="pt-user-menu">
              {me && (
                <div className="pt-user-menu-note">
                  ExPac Partner · <b>{PARTNER_LABEL[me.partner_kind]}</b>
                </div>
              )}
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
          <span className="pp-top-title">ExPac Partner Portal</span>
          <div className="pt-top-right">
            {me && (
              <span className="pp-top-company">
                {PARTNER_LABEL[me.partner_kind]} · <b>{me.company || "Your company"}</b>
              </span>
            )}
          </div>
        </header>
        <main className="main pt-main">
          {q.isLoading ? (
            <Loading />
          ) : q.isError ? (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Couldn't open your partner portal</h2>
              <ErrorNote error={q.error} />
              <p className="hint">Send this message to ExPac.</p>
            </div>
          ) : !me ? (
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Your login isn't linked yet</h2>
              <p className="hint">
                Open the invite link ExPac sent you and sign up with that email address, or ask ExPac for a new invite.
              </p>
            </div>
          ) : (
            <Outlet context={{ me, can } satisfies PartnerCtx} />
          )}
        </main>
      </div>
    </div>
  );
}
