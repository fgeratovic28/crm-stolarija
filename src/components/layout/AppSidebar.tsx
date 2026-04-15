import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Activity, DollarSign, Package, ClipboardList,
  FileText, FolderOpen, Shield, Settings, X, Hammer, Truck, Briefcase,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRole } from "@/contexts/RoleContext";
import { useI18n } from "@/contexts/I18nContext";
import { type ModuleName } from "@/config/permissions";
import { ROLE_CONFIG, type UserRole } from "@/types";

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
  module: ModuleName;
}

const navItems: NavItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", module: "dashboard" },
  { to: "/jobs", icon: Briefcase, labelKey: "nav.jobs", module: "jobs" },
  { to: "/activities", icon: Activity, labelKey: "nav.activities", module: "activities" },
  { to: "/finances", icon: DollarSign, labelKey: "nav.finances", module: "finances" },
  { to: "/material-orders", icon: Package, labelKey: "nav.materialOrders", module: "material-orders" },
  { to: "/suppliers", icon: Truck, labelKey: "nav.suppliers", module: "suppliers" },
  { to: "/work-orders", icon: ClipboardList, labelKey: "nav.workOrders", module: "work-orders" },
  { to: "/field-reports", icon: FileText, labelKey: "nav.fieldReports", module: "field-reports" },
  { to: "/files", icon: FolderOpen, labelKey: "nav.files", module: "files" },
  { to: "/teams", icon: Users, labelKey: "nav.teams", module: "teams" },
  { to: "/users", icon: Shield, labelKey: "nav.users", module: "users" },
  { to: "/settings", icon: Settings, labelKey: "nav.settings", module: "settings" },
];

interface AppSidebarProps {
  open: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ open, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const { hasAccess, currentUserName, currentRole } = useRole();
  const { t } = useI18n();

  const visibleItems = navItems.filter(item => hasAccess(item.module));

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Hammer className="w-4 h-4 text-primary-foreground" />
        </div>
        {open && <span className="text-lg font-semibold text-sidebar-accent-foreground tracking-tight">Stolarija CRM</span>}
      </div>
      <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onMobileClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {open && <span>{t(item.labelKey)}</span>}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border shrink-0">
        {open && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-semibold text-sidebar-accent-foreground">
              {currentUserName.split(" ").map(n => n[0]).join("")}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-sidebar-accent-foreground truncate">{currentUserName}</p>
              <p className="text-xs text-sidebar-muted truncate">
                {currentRole ? (ROLE_CONFIG[currentRole as UserRole]?.label ?? currentRole) : ""}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border shrink-0 transition-all duration-200",
          open ? "w-64" : "w-16"
        )}
      >
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/50" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar flex flex-col shadow-xl">
            <button onClick={onMobileClose} className="absolute top-4 right-4 text-sidebar-foreground hover:text-sidebar-accent-foreground">
              <X className="w-5 h-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
