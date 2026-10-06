// Partner portal (migration 0121): an agent / transporter / clearing agent
// login keeps ITS OWN rate sheets up to date, nothing else. The database
// only returns this partner's partner_rate_sheets (RLS), and they can add
// and edit but never delete. No tier sheets, sell rates, margins, customers,
// quotes or shipments are reachable from this login.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { ErrorNote, Loading } from "../../components/common";
import { useCan, useMyPartner } from "../../lib/hooks";
import { updateMyCoverage } from "../../lib/db";
import { useToast } from "../../components/Toast";
import { CoverageEditor, CoverageView, coverageOf, type Coverage } from "../partners/PartnerCoverage";
import type { MyPartner } from "../../lib/types";
import { PARTNER_LABEL } from "../../lib/tariff";
import PartnerRateSheets from "../partners/PartnerRateSheets";

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

export default function PartnerPortalPage() {
  const { user, signOut } = useAuth();
  const q = useMyPartner();
  const me = q.data;
  // Switches from Settings > Roles & Permissions (0131).
  const can = useCan();

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
              Keep your air and sea freight rates to ExPac Forwarding up to date, one rate sheet
              per mode and trade route, using ExPac's charge codes. Update them whenever your rates
              change (at least weekly); ExPac sees each change.
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
        )}
      </main>
    </div>
  );
}
