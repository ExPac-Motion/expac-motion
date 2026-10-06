import type { ReactNode } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import LoginPage from "./auth/LoginPage";
import SetNewPasswordPage from "./auth/SetNewPasswordPage";
import Layout from "./components/Layout";
import type { Profile } from "./lib/types";
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
import RateStructureDemoPage from "./pages/partners/RateStructureDemoPage";
import TierSheetsPage from "./pages/rates/TierSheetsPage";
import ClearingAgentsPage from "./pages/ClearingAgentsPage";
import DestinationAgentsPage from "./pages/DestinationAgentsPage";
import SettingsPage from "./pages/SettingsPage";
import ShipmentDocPrintPage from "./pages/ShipmentDocPrintPage";
import CrmPage from "./pages/CrmPage";
import RatesPage from "./pages/RatesPage";
import PortalLayout from "./pages/portal/PortalLayout";
import WmsPage from "./pages/WmsPage";
import CustomerRecordPage from "./pages/clients/CustomerRecordPage";
import WmsPrintPage from "./pages/wms/WmsPrintPage";
import WmsPrintDemoPage from "./pages/wms/WmsPrintDemoPage";
import PortalPendingPage from "./pages/portal/PortalPendingPage";
import PortalSignupPage from "./pages/portal/PortalSignupPage";
import PortalDashboardPage from "./pages/portal/PortalDashboardPage";
import PortalShipmentPage from "./pages/portal/PortalShipmentPage";
import PortalShipmentsPage from "./pages/portal/PortalShipmentsPage";
import PortalQuotesPage from "./pages/portal/PortalQuotesPage";
import PortalInvoicesPage from "./pages/portal/PortalInvoicesPage";
import PortalSuppliersPage from "./pages/portal/PortalSuppliersPage";
import PortalRatesPage from "./pages/portal/PortalRatesPage";
import PortalWarehousePage from "./pages/portal/PortalWarehousePage";
import PortalQuoteViewPage from "./pages/portal/PortalQuoteViewPage";
import PortalRequestQuotePage from "./pages/portal/PortalRequestQuotePage";
import PortalItemsPage from "./pages/portal/PortalItemsPage";
import PortalReportsPage from "./pages/portal/PortalReportsPage";
import PartnerPortalPage from "./pages/partner/PartnerPortalPage";
import PartnerSignupPage from "./pages/partner/PartnerSignupPage";
import RestrictedAccountPage from "./pages/RestrictedAccountPage";
import UnsubscribePage from "./pages/UnsubscribePage";
import FormPublicPage from "./pages/FormPublicPage";
import PublicTrackPage from "./pages/PublicTrackPage";
import { isSupabaseConfigured } from "./lib/supabase";
import { useCan, useMyProfile, useTierMargins } from "./lib/hooks";
import type { PermKey } from "./lib/permissions";

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <div className="center-note">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Staff-only app shell, a client-role login is bounced to /portal. */
function Protected() {
  const { session, loading } = useAuth();
  const profileQ = useMyProfile();
  // Editable tier margins (0130) applied app-wide once settings load.
  useTierMargins();
  if (loading || (session && profileQ.isLoading)) {
    return <div className="center-note">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (profileQ.data?.role === "restricted") return <RestrictedAccountPage />;
  if (profileQ.data?.role === "client") return <Navigate to="/portal" replace />;
  if (profileQ.data?.role === "partner") return <Navigate to="/partner" replace />;
  return <Layout />;
}

/** Partner portal (0121), agent / transporter / clearing agent logins only. */
function PartnerProtected() {
  const { session, loading } = useAuth();
  const profileQ = useMyProfile();
  if (loading || (session && profileQ.isLoading)) {
    return <div className="center-note">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (profileQ.data?.role === "restricted") return <RestrictedAccountPage />;
  if (profileQ.data?.role !== "partner") return <Navigate to="/" replace />;
  return <PartnerPortalPage />;
}

/** Admin-only pages (Rates & Tariff, buy rates, margins, partner rates).
 *  Renders inside Protected, so the profile has already loaded. The tables
 *  themselves are locked to is_admin() (0120); this just keeps other staff
 *  logins off an empty page. */
/** A page that needs a role permission (0131), Admin always passes. */
function NeedsPerm({ perm, children }: { perm: PermKey; children: ReactNode }) {
  const can = useCan();
  if (!can(perm)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Customer-facing shell, a staff login is bounced back to the main app. */
function PortalProtected() {
  const { session, loading } = useAuth();
  const profileQ = useMyProfile();
  if (loading || (session && profileQ.isLoading)) {
    return <div className="center-note">Loading…</div>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (profileQ.data?.role === "restricted") return <RestrictedAccountPage />;
  if (profileQ.data?.role !== "client") return <Navigate to="/" replace />;
  // null (pre-0068 accounts) and 'approved' both mean "go ahead".
  const status = profileQ.data?.portal_status;
  if (status === "pending" || status === "rejected") {
    return <PortalPendingPage status={status} />;
  }
  return <PortalLayout />;
}

/** Gates one portal section on the caller's own portal_permissions, set
 *  per login from Customers > Portal Access. Renders inside PortalProtected
 *  (already confirmed role='client' + approved), so profileQ.data is
 *  populated by the time this runs; still redirects to the dashboard on a
 *  hidden section instead of guessing, since a disabled permission can be
 *  toggled off at any time by an admin. */
function PortalSection({
  permission,
  children,
}: {
  permission: keyof Profile["portal_permissions"];
  children: ReactNode;
}) {
  const profileQ = useMyProfile();
  if (profileQ.data && profileQ.data.portal_permissions[permission] === false) {
    return <Navigate to="/portal" replace />;
  }
  return <>{children}</>;
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

/** Password-recovery links land the user in a valid session before any
 *  route gets a say in it, so this has to pre-empt routing entirely --
 *  otherwise LoginRoute or Protected would just bounce them into their
 *  normal dashboard/portal without ever prompting for a new password. */
function AppGate() {
  const { passwordRecovery } = useAuth();
  if (passwordRecovery) return <SetNewPasswordPage />;
  return <AppRoutes />;
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
          {import.meta.env.DEV && (
            <Route path="/quotes/demo/print" element={<QuotePrintDemoPage />} />
          )}
          {import.meta.env.DEV && (
            <Route path="/dev/wms-print" element={<WmsPrintDemoPage />} />
          )}
          {import.meta.env.DEV && <Route path="/dev/customer/:id" element={<div className="main"><CustomerRecordPage /></div>} />}
          {import.meta.env.DEV && (
            <Route path="/dev/portal" element={<PortalLayout />}>
              <Route index element={<PortalDashboardPage />} />
              <Route path="quote" element={<PortalRequestQuotePage />} />
            </Route>
          )}
          {import.meta.env.DEV && (
            <Route path="/dev/rate-structure" element={<RateStructureDemoPage />} />
          )}
          <Route path="/unsubscribe" element={<UnsubscribePage />} />
          <Route path="/forms/:id" element={<FormPublicPage />} />
          <Route path="/track" element={<PublicTrackPage />} />
          <Route path="/portal/signup" element={<PortalSignupPage />} />
          <Route path="/partner/signup" element={<PartnerSignupPage />} />
          <Route path="/partner" element={<PartnerProtected />} />
          <Route element={<PortalProtected />}>
            <Route path="portal" element={<PortalDashboardPage />} />
            <Route
              path="portal/shipments"
              element={
                <PortalSection permission="shipments">
                  <PortalShipmentsPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/shipments/:id"
              element={
                <PortalSection permission="shipments">
                  <PortalShipmentPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/quotes"
              element={
                <PortalSection permission="quotes">
                  <PortalQuotesPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/invoices"
              element={
                <PortalSection permission="invoices">
                  <PortalInvoicesPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/suppliers"
              element={
                <PortalSection permission="suppliers">
                  <PortalSuppliersPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/rates"
              element={
                <PortalSection permission="rates">
                  <PortalRatesPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/quotes/new"
              element={
                <PortalSection permission="quotes">
                  <PortalRequestQuotePage />
                </PortalSection>
              }
            />
            <Route
              path="portal/quotes/:id"
              element={
                <PortalSection permission="quotes">
                  <PortalQuoteViewPage />
                </PortalSection>
              }
            />
            <Route
              path="portal/items"
              element={
                <PortalSection permission="warehouse">
                  <PortalItemsPage />
                </PortalSection>
              }
            />
            <Route path="portal/reports" element={<PortalReportsPage />} />
            <Route
              path="portal/warehouse"
              element={
                <PortalSection permission="warehouse">
                  <PortalWarehousePage />
                </PortalSection>
              }
            />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="quotes/:id/print" element={<QuotePrintPage />} />
            <Route
              path="jobs/:id/documents/:doc/print"
              element={<ShipmentDocPrintPage />}
            />
            <Route path="wms/print/:doc/:id" element={<WmsPrintPage />} />
          </Route>
          <Route element={<Protected />}>
            <Route index element={<DashboardPage />} />
            <Route path="ops" element={<NeedsPerm perm="ops"><OpsControlTowerPage /></NeedsPerm>} />
            <Route path="quotes" element={<NeedsPerm perm="quotes"><QuotesListPage /></NeedsPerm>} />
            <Route path="wms" element={<NeedsPerm perm="warehouse"><WmsPage /></NeedsPerm>} />
            <Route path="import-vat-duty" element={<NeedsPerm perm="customs"><ImportVatDutyPage /></NeedsPerm>} />
            <Route path="quotes/new" element={<NeedsPerm perm="quotes"><QuoteBuilderPage /></NeedsPerm>} />
            <Route path="quotes/:id" element={<NeedsPerm perm="quotes"><QuoteBuilderPage /></NeedsPerm>} />
            <Route path="jobs" element={<NeedsPerm perm="shipments"><JobsPage /></NeedsPerm>} />
            <Route path="jobs/completed" element={<NeedsPerm perm="shipments"><CompletedJobsPage /></NeedsPerm>} />
            <Route path="clients" element={<NeedsPerm perm="customers"><ClientsPage /></NeedsPerm>} />
            <Route path="clients/:id" element={<NeedsPerm perm="customers"><CustomerRecordPage /></NeedsPerm>} />
            <Route path="crm" element={<CrmPage />} />
            <Route path="rates" element={<NeedsPerm perm="rates"><TierSheetsPage /></NeedsPerm>} />
            <Route path="rates/list" element={<NeedsPerm perm="rates"><RatesPage /></NeedsPerm>} />
            <Route path="suppliers" element={<NeedsPerm perm="suppliers"><SuppliersPage /></NeedsPerm>} />
            <Route path="agents" element={<NeedsPerm perm="suppliers"><AgentsPage /></NeedsPerm>} />
            <Route path="transporters" element={<NeedsPerm perm="suppliers"><TransportersPage /></NeedsPerm>} />
            <Route path="clearing-agents" element={<NeedsPerm perm="suppliers"><ClearingAgentsPage /></NeedsPerm>} />
            <Route path="destination-agents" element={<NeedsPerm perm="suppliers"><DestinationAgentsPage /></NeedsPerm>} />
            <Route path="settings" element={<NeedsPerm perm="settings"><SettingsPage /></NeedsPerm>} />
          </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeeded />;

  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  );
}
