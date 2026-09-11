import { useAuth } from "../../auth/AuthProvider";

/**
 * Shown instead of the portal dashboard while a self-serve signup
 * (portal_status='pending', see 0068_portal_self_signup.sql) hasn't been
 * approved yet, or after staff rejects one. The account can sign in the
 * whole time — is_staff() is false either way — it just can't see any
 * client data until approve_portal_signup() runs.
 */
export default function PortalPendingPage({
  status,
}: {
  status: "pending" | "rejected";
}) {
  const { signOut } = useAuth();

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-name">ExPac</div>
            <div className="brand-sub" style={{ color: "#9aa39a" }}>
              CUSTOMER PORTAL
            </div>
          </div>
        </div>
        {status === "pending" ? (
          <>
            <h1>Waiting on approval</h1>
            <p className="sub">
              Thanks for signing up. ExPac Forwarding has been notified and
              will approve your access shortly — check back soon, or we'll
              be in touch.
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
