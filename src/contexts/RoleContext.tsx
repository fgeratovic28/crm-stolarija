import { createContext, useContext, type ReactNode } from "react";
import type { UserRole } from "@/types";
import { useAuthStore } from "@/stores/auth-store";
import { MODULE_ACCESS, ACTION_ACCESS, type ModuleName, type ActionName } from "@/config/permissions";

interface RoleContextType {
  currentRole: UserRole | null;
  currentUserName: string;
  hasAccess: (module: ModuleName) => boolean;
  canPerformAction: (action: ActionName) => boolean;
}

const RoleContext = createContext<RoleContextType | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthStore();
  const currentRole = user?.role || null;
  const currentUserName = user?.name || "Gost";

  const hasAccess = (module: ModuleName) => {
    if (!currentRole) return false;
    return (MODULE_ACCESS[currentRole] as string[])?.includes(module) ?? false;
  };

  const canPerformAction = (action: ActionName) => {
    if (!currentRole) return false;
    return (ACTION_ACCESS[currentRole] as string[])?.includes(action) ?? false;
  };

  return (
    <RoleContext.Provider value={{ currentRole, currentUserName, hasAccess, canPerformAction }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
