import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName);
        setNotice(
          "Account created. If email confirmation is on, check your inbox, then sign in.",
        );
        setMode("in");
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
          <div className="brand-mark">E</div>
          <div>
            <div className="brand-name">ExPac</div>
            <div className="brand-sub" style={{ color: "#9aa39a" }}>
              MOTION
            </div>
          </div>
        </div>
        <h1>{mode === "in" ? "Sign in" : "Create account"}</h1>
        <p className="sub">
          {mode === "in"
            ? "Use your ExPac Motion login."
            : "Set up a login for a team member."}
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

        <button className="btn" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <div className="auth-toggle">
          {mode === "in" ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setMode("up");
                setErr("");
              }}
            >
              Need a login? Create an account
            </button>
          ) : (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setMode("in");
                setErr("");
              }}
            >
              Already have a login? Sign in
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
