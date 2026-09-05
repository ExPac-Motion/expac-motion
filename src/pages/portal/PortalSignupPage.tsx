import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { claimClientInvite, getInvite } from "../../lib/db";
import { useInvite } from "../../lib/hooks";

/**
 * Reached via a link staff shares with a customer (?token=...). Signs the
 * customer up with the same Supabase Auth used everywhere else, then
 * claims the invite so their new account is scoped to just their own
 * company's data (see claim_client_invite in 0026_customer_portal.sql).
 *
 * Deliberately does NOT auto-claim just because a session already exists
 * on this page load — if email confirmation is required, or if someone
 * (e.g. a staff member) opens this link while already signed in as
 * someone else, silently attaching a random ambient session to this
 * invite would be a real privilege bug. Claiming only ever happens right
 * after THIS form's own signUp/signIn call, scoped to the account just
 * created here.
 */
export default function PortalSignupPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { signUp, signIn } = useAuth();
  const inviteQ = useInvite(token || undefined);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function finishClaim() {
    await claimClientInvite(token);
    navigate("/portal", { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      // Re-check right before use — invites can only be claimed once.
      const invite = await getInvite(token);
      if (invite.claimed_at) throw new Error("This invite link has already been used.");

      await signUp(email, password, email);
      try {
        await signIn(email, password);
      } catch {
        // Most likely "Email not confirmed" — this project requires clicking
        // a confirmation link before the new account can sign in.
        setAwaitingConfirmation(true);
        setNotice(
          "Check your email to confirm your account, then come back here and click Continue.",
        );
        return;
      }
      await finishClaim();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onContinueAfterConfirmation(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await signIn(email, password);
      await finishClaim();
    } catch (e2) {
      setErr(
        e2 instanceof Error
          ? e2.message
          : "Still can't sign you in — make sure you clicked the confirmation link first.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Invalid link</h1>
          <p className="sub">This portal sign-up link is missing its invite code.</p>
        </div>
      </div>
    );
  }

  if (inviteQ.isLoading) {
    return <div className="center-note">Checking your invite…</div>;
  }
  if (inviteQ.isError || !inviteQ.data || inviteQ.data.claimed_at) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Invite not found</h1>
          <p className="sub">
            This link is invalid or has already been used. Ask ExPac for a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form
        className="auth-card"
        onSubmit={awaitingConfirmation ? onContinueAfterConfirmation : onSubmit}
      >
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-name">ExPac</div>
            <div className="brand-sub" style={{ color: "#9aa39a" }}>
              CUSTOMER PORTAL
            </div>
          </div>
        </div>
        <h1>Set up your portal login</h1>
        <p className="sub">
          Track your shipments, view quotes and documents, and message ExPac
          directly.
        </p>

        {err && <div className="auth-error">{err}</div>}
        {notice && (
          <div
            className="auth-error"
            style={{ background: "#e5f3d9", color: "#4a6b1f" }}
          >
            {notice}
          </div>
        )}

        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder={inviteQ.data.email ?? undefined}
            disabled={awaitingConfirmation}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            disabled={awaitingConfirmation}
            required
          />
        </div>

        <button
          className="btn"
          type="submit"
          disabled={busy}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {busy
            ? "Please wait…"
            : awaitingConfirmation
              ? "Continue"
              : "Create my login"}
        </button>
      </form>
    </div>
  );
}
