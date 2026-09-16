import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

export default function LoginPage() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  function switchMode(next: "in" | "up" | "forgot") {
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
      } else if (mode === "up") {
        await signUp(email, password, fullName);
        setNotice(
          "Account created. If email confirmation is on, check your inbox, then sign in.",
        );
        setMode("in");
      } else {
        await requestPasswordReset(email);
        setNotice(
          "If that email has a login, a reset link is on its way — check your inbox.",
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
              src="https://fdzwnvinqiqrexhzgqkp.supabase.co/storage/v1/object/public/mail-assets/media/d2dbb470-55b1-483c-92ff-0cba3a2756b5.png"
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
          {mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Reset your password"}
        </h1>
        <p className="sub">
          {mode === "in"
            ? "Use your ExPac Motion login."
            : mode === "up"
              ? "Set up a login for a team member."
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

        {mode === "up" && (
          <div className="field">
            <label>Full name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
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
              : mode === "up"
                ? "Create account"
                : "Send reset link"}
        </button>

        <div className="auth-toggle">
          {mode === "in" && (
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode("up")}
            >
              Need a login? Create an account
            </button>
          )}
          {mode !== "in" && (
            <button
              type="button"
              className="link-btn"
              onClick={() => switchMode("in")}
            >
              {mode === "up" ? "Already have a login? Sign in" : "Back to sign in"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
