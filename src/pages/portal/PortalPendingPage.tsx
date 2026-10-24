import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BRAND_LOGO_URL } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { claimClientInvite, forgetPendingInvite, pendingInvite } from "../../lib/db";

/**
 * Shown instead of the portal dashboard while a self-serve signup
 * (portal_status='pending', see 0068_portal_self_signup.sql) hasn't been
 * approved yet, or after staff rejects one. The account can sign in the
 * whole time, is_staff() is false either way, it just can't see any
 * client data until approve_portal_signup() runs.
 *
 * An INVITED customer can land here too: they confirmed their email from
 * the confirmation link instead of clicking Continue on the invite page, so
 * the invite isn't claimed yet. When this browser remembers that invite
 * (and it's for the signed-in address), "Finish setting up" claims it.
 */
export default function PortalPendingPage({
  status,
}: {
  status: "pending" | "rejected";
}) {
  const { signOut, session } = useAuth();
  const qc = useQueryClient();
  const [invite, setInvite] = useState(pendingInvite);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const me = session?.user.email?.trim().toLowerCase() ?? "";
  const canFinish =
    status === "pending" && invite && (!invite.email || invite.email.trim().toLowerCase() === me);

  async function onFinish() {
    if (!invite) return;
    setErr("");
    setBusy(true);
    try {
      await claimClientInvite(invite.token);
      // The profile is now approved and linked: PortalProtected re-reads it
      // and opens the portal.
      await qc.invalidateQueries({ queryKey: ["my_profile"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (/already-used|Invalid/i.test(msg)) {
        forgetPendingInvite();
        setInvite(null);
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">
            <img
              src={BRAND_LOGO_URL}
              alt="EXPAC"
            />
          </div>
          <div>
            <div className="brand-name">EXPAC</div>
            <div className="brand-sub" style={{ color: "var(--muted)" }}>
              CUSTOMER PORTAL
            </div>
          </div>
        </div>
        {canFinish ? (
          <>
            <h1>Finish setting up</h1>
            <p className="sub">
              Your email is confirmed. One last step links this login to your
              company's portal, as ExPac invited you.
            </p>
            {err && <div className="auth-error">{err}</div>}
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={onFinish}
              style={{ width: "100%", justifyContent: "center", marginBottom: 10 }}
            >
              {busy ? "Please wait…" : "Finish setting up"}
            </button>
          </>
        ) : status === "pending" ? (
          <>
            <h1>Waiting on approval</h1>
            <p className="sub">
              Thanks for signing up. ExPac Forwarding has been notified and
              will approve your access shortly, check back soon, or we'll
              be in touch.
            </p>
            {err && <div className="auth-error">{err}</div>}
            <p className="sub">
              Received an invite link from ExPac? Open it again on this device
              to finish setting up straight away.
            </p>
          </>
        ) : (
          <>
            <h1>Access request declined</h1>
            <p className="sub">
              ExPac Forwarding wasn't able to approve this account. Contact{" "}
              support@expac.co.za if you think this is a mistake.
            </p>
          </>
        )}
        <button className="btn outline" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
