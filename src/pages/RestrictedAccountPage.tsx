import { useAuth } from "../auth/AuthProvider";

/**
 * Shown instead of any app content — internal or portal — for role='restricted'
 * (see 0091_role_model_v2.sql). Used both to revoke a portal client's access
 * (client_id is kept so it can be restored) and to lock out a former staff
 * login without deleting it.
 */
export default function RestrictedAccountPage() {
  const { signOut } = useAuth();

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">
            <img
              src="https://fdzwnvinqiqrexhzgqkp.supabase.co/storage/v1/object/public/mail-assets/media/d2dbb470-55b1-483c-92ff-0cba3a2756b5.png"
              alt="EXPAC"
            />
          </div>
          <div>
            <div className="brand-name">EXPAC</div>
          </div>
        </div>
        <h1>Access restricted</h1>
        <p className="sub">
          This login's access has been restricted. Contact ExPac Forwarding
          if you believe this is a mistake.
        </p>
        <button className="btn outline" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
