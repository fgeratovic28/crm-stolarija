import { useEffect } from "react";
import { QueryClient, QueryClientProvider, hashKey, useQueryClient } from "@tanstack/react-query";
import { getReactQueryWindowScope } from "@/lib/react-query-window-scope";
import { applyDocumentLanguageFromCache } from "@/lib/app-settings";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
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
import WorkOrdersPage from "./pages/WorkOrdersPage";
import FieldReportsPage from "./pages/FieldReportsPage";
import FilesPage from "./pages/FilesPage";
import UsersPage from "./pages/UsersPage";
import TeamsPage from "./pages/TeamsPage";
import SettingsPage from "./pages/SettingsPage";
import SuppliersPage from "./pages/SuppliersPage";
import NotFound from "./pages/NotFound";
import PendingApprovalPage from "./pages/PendingApprovalPage";

import { OfflineBanner } from "@/components/shared/OfflineBanner";

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <ProtectedRoute module="jobs">
          <JobsListPage />
        </ProtectedRoute>
      } />
      
      <Route path="/jobs/:id" element={
        <ProtectedRoute module="jobs">
          <JobDetailsPage />
        </ProtectedRoute>
      } />

      <Route path="/customers/new" element={
        <ProtectedRoute module="jobs">
          <CustomersPage />
        </ProtectedRoute>
      } />

      <Route path="/customers/:id/edit" element={
        <ProtectedRoute module="jobs">
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
      
      <Route path="/suppliers" element={
        <ProtectedRoute module="material-orders">
          <SuppliersPage />
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
      
      <Route path="/settings" element={
        <ProtectedRoute module="settings">
          <SettingsPage />
        </ProtectedRoute>
      } />
      
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ReactQueryVisibilitySync />
    <TooltipProvider>
      <I18nProvider>
        <RoleProvider>
          <Toaster />
          <Sonner position="top-right" closeButton />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppContent />
            <OfflineBanner />
          </BrowserRouter>
        </RoleProvider>
      </I18nProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
