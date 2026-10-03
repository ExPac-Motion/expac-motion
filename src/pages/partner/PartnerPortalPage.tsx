// Partner portal (migration 0121): an agent / transporter / clearing agent
// login keeps ITS OWN rate sheets up to date — nothing else. The database
// only returns this partner's partner_rate_sheets (RLS), and they can add
// and edit but never delete. No tier sheets, sell rates, margins, customers,
// quotes or shipments are reachable from this login.
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Loading } from "../../components/common";
import { useMyPartner } from "../../lib/hooks";
import { PARTNER_LABEL } from "../../lib/tariff";
import PartnerRateSheets from "../partners/PartnerRateSheets";

export default function PartnerPortalPage() {
  const { user, signOut } = useAuth();
  const q = useMyPartner();
  const me = q.data;

  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/partner" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>
        <nav className="topbar-primary">
          <span className="topbar-tab active">Rate Sheets</span>
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
        {q.isLoading ? (
          <Loading />
        ) : !me ? (
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Your login isn't linked yet</h2>
            <p className="hint">
              Open the invite link ExPac sent you and sign up with that email address, or ask
              ExPac for a new invite.
            </p>
          </div>
        ) : (
          <>
            <p className="hint" style={{ margin: "0 0 4px" }}>
              ExPac Partner Portal · {PARTNER_LABEL[me.partner_kind]}
            </p>
            <h1 style={{ margin: "0 0 6px" }}>{me.company || "Your company"}</h1>
            <p className="hint" style={{ margin: "0 0 14px" }}>
              Keep your buy rates to ExPac up to date — one rate sheet per mode and trade route,
              using ExPac's charge codes. Update them whenever your rates change (at least weekly);
              ExPac sees each change.
            </p>
            <div className="panel">
              <PartnerRateSheets
                kind={me.partner_kind}
                partnerId={me.partner_id}
                partnerName={me.company || "your company"}
                canDelete={false}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
