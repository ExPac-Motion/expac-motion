// /partner/signup?token=…, an agent / transporter / clearing agent creates
// their partner-portal login from an ExPac invite (migration 0121).
// signup_kind "partner" makes handle_new_user() create the profile as
// role='partner' (never staff) from the first instant; claim_partner_invite
// then links it to the partner, and only if the email matches the invite.
// Like the customer invite page, it only ever claims right after THIS
// form's own signUp / signIn, never an ambient session.
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { claimPartnerInvite, getPartnerInvite } from "../../lib/db";
import { PARTNER_LABEL } from "../../lib/tariff";

export default function PartnerSignupPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { signUp, signIn } = useAuth();
  const inviteQ = useQuery({
    queryKey: ["partner_invite", token],
    queryFn: () => getPartnerInvite(token),
    enabled: !!token,
    retry: false,
  });
  const invite = inviteQ.data;

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [awaiting, setAwaiting] = useState(false);

  async function finish() {
    await claimPartnerInvite(token);
    navigate("/partner", { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      await signUp(invite.email, password, name.trim() || invite.email, {
        signup_kind: "partner",
      });
      try {
        await signIn(invite.email, password);
      } catch {
        setAwaiting(true);
        setNotice(
          "Check your email to confirm your account, then come back here and click Continue.",
        );
        return;
      }
      await finish();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function onContinue(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setErr("");
    setBusy(true);
    try {
      await signIn(invite.email, password);
      await finish();
    } catch (e2) {
      setErr(
        e2 instanceof Error
          ? e2.message
          : "Still can't sign you in, make sure you clicked the confirmation link first.",
      );
    } finally {
      setBusy(false);
    }
  }

  const brand = (
    <div className="brand">
      <div className="brand-mark">
        <img
          src="https://fdzwnvinqiqrexhzgqkp.supabase.co/storage/v1/object/public/mail-assets/media/d2dbb470-55b1-483c-92ff-0cba3a2756b5.png"
          alt="EXPAC"
        />
      </div>
      <div>
        <div className="brand-name">EXPAC</div>
        <div className="brand-sub" style={{ color: "var(--muted)" }}>
          PARTNER PORTAL
        </div>
      </div>
    </div>
  );

  if (!token || inviteQ.isError || (inviteQ.isFetched && !invite)) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          {brand}
          <h1>Invite not found</h1>
          <p className="sub">
            This link is invalid or has already been used. Ask ExPac for a new one, or, if you
            already have a login, <a href="/login">sign in</a>.
          </p>
        </div>
      </div>
    );
  }
  if (!invite) return <div className="center-note">Checking your invite…</div>;

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={awaiting ? onContinue : onSubmit}>
        {brand}
        <h1>Set up your partner login</h1>
        <p className="sub">
          {invite.company || "Your company"} · {PARTNER_LABEL[invite.partner_kind]}. Keep your rate
          sheets to ExPac up to date.
        </p>

        {err && <div className="auth-error">{err}</div>}
        {notice && (
          <div
            className="auth-error"
            style={{ background: "var(--green-tint)", color: "var(--green-dark)" }}
          >
            {notice}
          </div>
        )}

        <div className="field">
          <label>Email</label>
          <input type="email" value={invite.email} disabled />
        </div>
        <div className="field">
          <label>Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            disabled={awaiting}
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
            disabled={awaiting}
            required
          />
        </div>
        <button
          className="btn"
          type="submit"
          disabled={busy}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {busy ? "Please wait…" : awaiting ? "Continue" : "Create my login"}
        </button>
      </form>
    </div>
  );
}
