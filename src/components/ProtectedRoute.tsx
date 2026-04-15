import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { type ModuleName } from "@/config/permissions";

interface ProtectedRouteProps {
  children: React.ReactNode;
  module?: ModuleName;
}

export function ProtectedRoute({ children, module }: ProtectedRouteProps) {
  const { isAuthenticated, authReady, isPendingApproval } = useAuthStore();
  const { hasAccess } = useRole();
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background" aria-busy="true">
        <div className="text-sm text-muted-foreground">Provera sesije...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isPendingApproval) {
    return <Navigate to="/pending-approval" replace />;
  }

  if (module && !hasAccess(module)) {
    if (location.pathname === "/") {
      return <Navigate to="/login" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
