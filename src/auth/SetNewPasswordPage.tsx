import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

/** Shown in place of any route while a password-recovery session is active
 *  (i.e. the user just clicked a reset link from their email) — see
 *  AuthProvider's passwordRecovery flag. */
export default function SetNewPasswordPage() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (password !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
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
        <h1>Set a new password</h1>
        <p className="sub">Choose a new password for your account.</p>

        {err && <div className="auth-error">{err}</div>}
        {done && (
          <div
            className="auth-error"
            style={{ background: "#e5f3d9", color: "#4a6b1f" }}
          >
            Password updated.
          </div>
        )}

        {done ? (
          <button
            type="button"
            className="btn"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => signOut()}
          >
            Continue to sign in
          </button>
        ) : (
          <>
            <div className="field">
              <label>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <button
              className="btn"
              type="submit"
              disabled={busy}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {busy ? "Saving…" : "Set new password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
