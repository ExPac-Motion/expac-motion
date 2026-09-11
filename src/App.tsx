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
import QuotePrintDemoPage from "./pages/QuotePrintDemoPage";
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
import DeliveryInstructionPrintPage from "./pages/DeliveryInstructionPrintPage";
import CrmPage from "./pages/CrmPage";
import RatesPage from "./pages/RatesPage";
import PortalLayout from "./pages/portal/PortalLayout";
import PortalPendingPage from "./pages/portal/PortalPendingPage";
import PortalSignupPage from "./pages/portal/PortalSignupPage";
import PortalDashboardPage from "./pages/portal/PortalDashboardPage";
import PortalShipmentPage from "./pages/portal/PortalShipmentPage";
import PortalShipmentsPage from "./pages/portal/PortalShipmentsPage";
import PortalQuotesPage from "./pages/portal/PortalQuotesPage";
import PortalInvoicesPage from "./pages/portal/PortalInvoicesPage";
import PortalSuppliersPage from "./pages/portal/PortalSuppliersPage";
import PortalRatesPage from "./pages/portal/PortalRatesPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import FormPublicPage from "./pages/FormPublicPage";
import PublicTrackPage from "./pages/PublicTrackPage";
import { isSupabaseConfigured } from "./lib/supabase";
import { useMyProfile } from "./lib/hooks";

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-note">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Staff-only app shell — a client-role login is bounced to /portal. */
function Protected() {
  const { session, loading } = useAuth();
  const profileQ = useMyProfile();
  if (loading || (session && profileQ.isLoading)) {
    return <div className="center-note">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (profileQ.data?.role === "client") return <Navigate to="/portal" replace />;
  return <Layout />;
}

/** Customer-facing shell — a staff login is bounced back to the main app. */
function PortalProtected() {
  const { session, loading } = useAuth();
  const profileQ = useMyProfile();
  if (loading || (session && profileQ.isLoading)) {
    return <div className="center-note">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (profileQ.data?.role !== "client") return <Navigate to="/" replace />;
  // null (pre-0068 accounts) and 'approved' both mean "go ahead".
  const status = profileQ.data?.portal_status;
  if (status === "pending" || status === "rejected") {
    return <PortalPendingPage status={status} />;
  }
  return <PortalLayout />;
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
          {import.meta.env.DEV && (
            <Route path="/quotes/demo/print" element={<QuotePrintDemoPage />} />
          )}
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/forms/:id" element={<FormPublicPage />} />
          <Route path="/track" element={<PublicTrackPage />} />
          <Route path="/portal/signup" element={<PortalSignupPage />} />
          <Route element={<PortalProtected />}>
            <Route path="portal" element={<PortalDashboardPage />} />
            <Route path="portal/shipments" element={<PortalShipmentsPage />} />
            <Route path="portal/shipments/:id" element={<PortalShipmentPage />} />
            <Route path="portal/quotes" element={<PortalQuotesPage />} />
            <Route path="portal/invoices" element={<PortalInvoicesPage />} />
            <Route path="portal/suppliers" element={<PortalSuppliersPage />} />
            <Route path="portal/rates" element={<PortalRatesPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="quotes/:id/print" element={<QuotePrintPage />} />
            <Route
              path="jobs/:id/documents/delivery-instruction/print"
              element={<DeliveryInstructionPrintPage />}
            />
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
            <Route path="crm" element={<CrmPage />} />
            <Route path="rates" element={<RatesPage />} />
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
