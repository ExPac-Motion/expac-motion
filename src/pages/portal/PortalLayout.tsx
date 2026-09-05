import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

export default function PortalLayout() {
  const { user, signOut } = useAuth();
  return (
    <div className="app-shell">
      <header className="topbar-nav">
        <Link to="/portal" className="topbar-brand">
          <img src="/ExPac-Final_Maybe-300x106.png" alt="ExPac Motion" />
        </Link>
        <nav className="topbar-primary">
          <span className="topbar-tab active">My Shipments</span>
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
        <Outlet />
      </main>
    </div>
  );
}
