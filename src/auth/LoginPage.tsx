import { BRAND_LOGO_URL } from "../lib/supabase";
import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

export default function LoginPage() {
  const { signIn, requestPasswordReset } = useAuth();
  // Nobody signs up here: staff logins are made by an Admin, customers ask
  // for access on the Customer Portal sign-up (0189).
  const [mode, setMode] = useState<"in" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  function switchMode(next: "in" | "forgot") {
    setMode(next);
    setErr("");
    setNotice("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
      } else {
        await requestPasswordReset(email);
        setNotice(
          "If that email has a login, a reset link is on its way, check your inbox.",
        );
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <div className="brand-mark">
            <img
              src={BRAND_LOGO_URL}
              alt="EXPAC"
            />
          </div>
          <div>
            <div className="brand-name">EXPAC</div>
            <div className="brand-sub" style={{ color: "#9aa39a" }}>
              MOTION
            </div>
          </div>
        </div>
        <h1>
          {mode === "in" ? "Sign in" : "Reset your password"}
        </h1>
        <p className="sub">
          {mode === "in"
            ? "Use your ExPac Motion login."
            : "Enter your email and we'll send you a link to set a new password."}
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
            required
          />
        </div>
        {mode !== "forgot" && (
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              minLength={6}
              required
            />
          </div>
        )}
        {mode === "in" && (
          <button
            type="button"
            className="link-btn"
            style={{ marginBottom: 14 }}
            onClick={() => switchMode("forgot")}
          >
            Forgot your password?
          </button>
        )}

        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy
            ? "Please wait…"
            : mode === "in"
              ? "Sign in"
              : "Send reset link"}
        </button>

        <div className="auth-toggle">
          {mode === "in" ? (
            <a className="link-btn" href="/portal/signup">
              New customer? Request portal access
            </a>
          ) : (
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode("in")}
            >
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
