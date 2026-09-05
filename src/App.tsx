import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import LoginPage from "./auth/LoginPage";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import QuotesListPage from "./pages/QuotesListPage";
import QuoteBuilderPage from "./pages/QuoteBuilderPage";
import QuotePrintPage from "./pages/QuotePrintPage";
import ImportVatDutyPage from "./pages/ImportVatDutyPage";
import OpsControlTowerPage from "./pages/OpsControlTowerPage";
import JobsPage from "./pages/JobsPage";
import CompletedJobsPage from "./pages/CompletedJobsPage";
import ClientsPage from "./pages/ClientsPage";
import SuppliersPage from "./pages/SuppliersPage";
import AgentsPage from "./pages/AgentsPage";
import TransportersPage from "./pages/TransportersPage";
import ClearingAgentsPage from "./pages/ClearingAgentsPage";
import SettingsPage from "./pages/SettingsPage";
import { isSupabaseConfigured } from "./lib/supabase";

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-note">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Protected() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-note">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Layout />;
}

function LoginRoute() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-note">Loading…</div>;
  if (session) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function SetupNeeded() {
  return (
    <div className="center-note">
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ marginBottom: 12 }}>Finish setup</h1>
        <p>
          The app can't reach a backend yet. Create a Supabase project, then copy{" "}
          <code>.env.example</code> to <code>.env.local</code> and fill in{" "}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
        <p>
          Full steps are in <code>SETUP.md</code> in the project root. Restart{" "}
          <code>npm run dev</code> after editing the env file.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeeded />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireAuth />}>
            <Route path="quotes/:id/print" element={<QuotePrintPage />} />
          </Route>
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="ops" element={<OpsControlTowerPage />} />
            <Route path="quotes" element={<QuotesListPage />} />
            <Route path="import-vat-duty" element={<ImportVatDutyPage />} />
            <Route path="quotes/new" element={<QuoteBuilderPage />} />
            <Route path="quotes/:id" element={<QuoteBuilderPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/completed" element={<CompletedJobsPage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="transporters" element={<TransportersPage />} />
            <Route path="clearing-agents" element={<ClearingAgentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
