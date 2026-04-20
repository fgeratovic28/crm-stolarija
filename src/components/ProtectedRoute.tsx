import { Navigate, useLocation } from "react-router-dom";
import { AppSessionLoadingScreen } from "@/components/AppSessionLoadingScreen";
import { AuthHydratingFallback } from "@/components/AuthHydratingFallback";
import { hasRichSplashCompleted } from "@/lib/rich-splash-session";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { type ModuleName } from "@/config/permissions";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Jedan modul ili više (dovoljan je jedan — OR). */
  module?: ModuleName | ModuleName[];
}

export function ProtectedRoute({ children, module }: ProtectedRouteProps) {
  const { isAuthenticated, authReady, isPendingApproval } = useAuthStore();
  const { hasAccess } = useRole();
  const location = useLocation();

  if (!authReady) {
    if (hasRichSplashCompleted()) {
      return <AuthHydratingFallback />;
    }
    return <AppSessionLoadingScreen sessionReady={false} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isPendingApproval && location.pathname !== "/pending-approval") {
    return <Navigate to="/pending-approval" replace />;
  }

  if (!isPendingApproval && location.pathname === "/pending-approval") {
    return <Navigate to="/" replace />;
  }

  const moduleAllowed =
    !module ||
    (Array.isArray(module) ? module.some((m) => hasAccess(m)) : hasAccess(module));

  if (!moduleAllowed) {
    if (location.pathname === "/") {
      return <Navigate to="/login" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
