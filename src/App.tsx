import { useEffect } from "react";
import { QueryClient, QueryClientProvider, hashKey, useQueryClient } from "@tanstack/react-query";
import { getReactQueryWindowScope } from "@/lib/react-query-window-scope";
import { applyDocumentLanguageFromCache } from "@/lib/app-settings";
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoleProvider } from "@/contexts/RoleContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import JobsListPage from "./pages/JobsListPage";
import JobDetailsPage from "./pages/JobDetailsPage";
import CustomersPage from "./pages/CustomersPage";
import ActivitiesPage from "./pages/ActivitiesPage";
import FinancesPage from "./pages/FinancesPage";
import MaterialOrdersPage from "./pages/MaterialOrdersPage";
import OrderReception from "./pages/OrderReception";
import MaterialReceptionPage from "./pages/MaterialReceptionPage";
import WorkOrdersPage from "./pages/WorkOrdersPage";
import FieldReportsPage from "./pages/FieldReportsPage";
import FilesPage from "./pages/FilesPage";
import UsersPage from "./pages/UsersPage";
import TeamsPage from "./pages/TeamsPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilePage from "./pages/ProfilePage";
import SuppliersPage from "./pages/SuppliersPage";
import VehiclesPage from "./pages/VehiclesPage";
import WorkersPage from "./pages/WorkersPage";
import CompletedJobsMapPage from "./pages/CompletedJobsMapPage";
import NotFound from "./pages/NotFound";
import PublicNarudzbenicaPage from "./pages/PublicNarudzbenicaPage";
import PublicProcurementOrderRedirectPage from "./pages/PublicProcurementOrderRedirectPage";
import PendingApprovalPage from "./pages/PendingApprovalPage";

import { ThemeProvider } from "@/contexts/ThemeContext";
import { InstallAppPrompt } from "@/components/shared/InstallAppPrompt";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { MaintenanceModeGate } from "@/components/MaintenanceModeGate";
import { SessionEntryGate } from "@/components/SessionEntryGate";
import { useAuthStore } from "@/stores/auth-store";
import { useGlobalSupabaseRealtimeSync } from "@/hooks/use-global-supabase-realtime-sync";

function GlobalRealtimeSync() {
  const { isAuthenticated, authReady, authProfileReady } = useAuthStore();
  useGlobalSupabaseRealtimeSync(Boolean(authReady && authProfileReady && isAuthenticated));
  return null;
}

const isElectronBuild = import.meta.env.VITE_ELECTRON_BUILD === "true";
const AppRouter = isElectronBuild ? HashRouter : BrowserRouter;

function LegacyMaterialOrderReceptionRedirect() {
  const { orderId } = useParams<{ orderId: string }>();
  if (!orderId?.trim()) return <Navigate to="/material-orders" replace />;
  return <Navigate to={`/order-reception/${orderId.trim()}`} replace />;
}

const reactQueryWindowScope =
  typeof window !== "undefined" ? getReactQueryWindowScope() : "ssr";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      refetchOnReconnect:
        typeof window === "undefined" || document.visibilityState === "visible",
      queryKeyHashFn: (queryKey) => hashKey([reactQueryWindowScope, ...queryKey]),
    },
  },
});

/** Drži refetch pri reconnect usklađenim sa vidljivošću taba (drugi prozor u pozadini ne refetch-uje paralelno). */
function ReactQueryVisibilitySync() {
  const client = useQueryClient();

  useEffect(() => {
    const apply = () => {
      const visible = document.visibilityState === "visible";
      const cur = client.getDefaultOptions();
      client.setDefaultOptions({
        ...cur,
        queries: {
          ...cur.queries,
          refetchOnReconnect: visible,
        },
      });
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [client]);

  return null;
}

const AppContent = () => {
  useSupabaseAuth();

  useEffect(() => {
    applyDocumentLanguageFromCache();
  }, []);

  return (
    <MaintenanceModeGate>
    <SessionEntryGate>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/order-reception/:orderId" element={<OrderReception />} />
      <Route path="/narudzbenica/:token" element={<PublicNarudzbenicaPage />} />
      <Route path="/r/order/:orderId" element={<PublicProcurementOrderRedirectPage />} />
      <Route
        path="/pending-approval"
        element={
          <ProtectedRoute>
            <PendingApprovalPage />
          </ProtectedRoute>
        }
      />
      
      <Route path="/" element={
        <ProtectedRoute module="dashboard">
          <DashboardPage />
        </ProtectedRoute>
      } />
      
      <Route path="/jobs" element={
        <ProtectedRoute module={["jobs", "customers"]}>
          <JobsListPage />
        </ProtectedRoute>
      } />

      <Route path="/customers" element={
        <ProtectedRoute module={["customers", "jobs"]}>
          <JobsListPage />
        </ProtectedRoute>
      } />

      <Route path="/jobs-map" element={
        <ProtectedRoute module="jobs-map">
          <CompletedJobsMapPage />
        </ProtectedRoute>
      } />
      
      <Route path="/jobs/:id" element={
        <ProtectedRoute module="jobs">
          <JobDetailsPage />
        </ProtectedRoute>
      } />

      <Route path="/customers/new" element={
        <ProtectedRoute module={["customers", "jobs"]}>
          <CustomersPage />
        </ProtectedRoute>
      } />

      <Route path="/customers/:id/edit" element={
        <ProtectedRoute module={["customers", "jobs"]}>
          <CustomersPage />
        </ProtectedRoute>
      } />
      
      <Route path="/activities" element={
        <ProtectedRoute module="activities">
          <ActivitiesPage />
        </ProtectedRoute>
      } />
      
      <Route path="/finances" element={
        <ProtectedRoute module="finances">
          <FinancesPage />
        </ProtectedRoute>
      } />
      
      <Route path="/material-orders" element={
        <ProtectedRoute module="material-orders">
          <MaterialOrdersPage />
        </ProtectedRoute>
      } />

      <Route path="/material-orders/:orderId/reception" element={<LegacyMaterialOrderReceptionRedirect />} />

      <Route path="/material-reception" element={
        <ProtectedRoute module="material-reception">
          <MaterialReceptionPage />
        </ProtectedRoute>
      } />
      
      <Route path="/suppliers" element={
        <ProtectedRoute module="material-orders">
          <SuppliersPage />
        </ProtectedRoute>
      } />

      <Route path="/vehicles" element={
        <ProtectedRoute module="vehicles">
          <VehiclesPage />
        </ProtectedRoute>
      } />

      <Route path="/workers" element={
        <ProtectedRoute module="workers">
          <WorkersPage />
        </ProtectedRoute>
      } />
      
      <Route path="/work-orders" element={
        <ProtectedRoute module="work-orders">
          <WorkOrdersPage />
        </ProtectedRoute>
      } />
      
      <Route path="/field-reports" element={
        <ProtectedRoute module="field-reports">
          <FieldReportsPage />
        </ProtectedRoute>
      } />
      
      <Route path="/files" element={
        <ProtectedRoute module="files">
          <FilesPage />
        </ProtectedRoute>
      } />

      <Route path="/users" element={
        <ProtectedRoute module="users">
          <UsersPage />
        </ProtectedRoute>
      } />
      
      <Route path="/teams" element={
        <ProtectedRoute module="users">
          <TeamsPage />
        </ProtectedRoute>
      } />
      
      <Route path="/profile" element={
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      } />

      <Route path="/settings" element={
        <ProtectedRoute module="settings">
          <SettingsPage />
        </ProtectedRoute>
      } />
      
      <Route path="*" element={<NotFound />} />
    </Routes>
    </SessionEntryGate>
    </MaintenanceModeGate>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ReactQueryVisibilitySync />
    <GlobalRealtimeSync />
    <ThemeProvider>
      <TooltipProvider>
        <I18nProvider>
          <RoleProvider>
            <Toaster />
            <Sonner position="top-right" closeButton />
            <AppRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <AppContent />
              <InstallAppPrompt />
              <OfflineBanner />
            </AppRouter>
          </RoleProvider>
        </I18nProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
