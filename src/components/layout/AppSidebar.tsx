import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Activity, DollarSign, Package, ClipboardList,
  FileText, FolderOpen, Shield, Settings, X, Hammer, Truck, Briefcase, Layers, Wrench, ChevronDown, MapPinned,
  Receipt,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
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

interface NavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavItem[];
}

const dashboardItem: NavItem = { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", module: "dashboard" };
const settingsItem: NavItem = { to: "/settings", icon: Settings, labelKey: "nav.settings", module: "settings" };

const salesFinanceBaseChildren: NavItem[] = [
  { to: "/jobs?tab=customers", icon: Users, labelKey: "nav.customers", module: "customers" },
  { to: "/jobs?tab=jobs", icon: Briefcase, labelKey: "nav.jobsOnly", module: "jobs" },
  { to: "/jobs-map", icon: MapPinned, labelKey: "nav.completedJobsMap", module: "jobs" },
  { to: "/activities", icon: Activity, labelKey: "nav.activities", module: "activities" },
];

/** Tri stavke samo za ulogu `finance`; ostali (admin, kancelarija, …) vide jednu „Finansije“. */
const financeNavSplit: NavItem[] = [
  { to: "/finances?tab=overview", icon: DollarSign, labelKey: "nav.financeOverview", module: "finances" },
  { to: "/finances?tab=payments", icon: Receipt, labelKey: "nav.financePayments", module: "finances" },
  { to: "/finances?tab=reports", icon: FileText, labelKey: "nav.financeReports", module: "finances" },
];

const financeNavSingle: NavItem = {
  to: "/finances?tab=overview",
  icon: DollarSign,
  labelKey: "nav.finances",
  module: "finances",
};

const navGroupsTail: NavGroup[] = [
  {
    id: "resources-procurement",
    label: "Resursi i Nabavka",
    icon: Package,
    children: [
      { to: "/suppliers", icon: Truck, labelKey: "nav.suppliers", module: "suppliers" },
      { to: "/material-orders", icon: Package, labelKey: "nav.materialOrders", module: "material-orders" },
      { to: "/vehicles", icon: Truck, labelKey: "nav.vehicles", module: "vehicles" },
    ],
  },
  {
    id: "operations",
    label: "Operativa",
    icon: Wrench,
    children: [
      { to: "/work-orders", icon: ClipboardList, labelKey: "nav.workOrders", module: "work-orders" },
      { to: "/field-reports", icon: FileText, labelKey: "nav.fieldReports", module: "field-reports" },
      { to: "/teams", icon: Users, labelKey: "nav.teams", module: "teams" },
      { to: "/files", icon: FolderOpen, labelKey: "nav.files", module: "files" },
    ],
  },
  {
    id: "system-hr",
    label: "Sistem i HR",
    icon: Layers,
    children: [
      { to: "/workers", icon: Users, labelKey: "nav.workers", module: "workers" },
      { to: "/users", icon: Shield, labelKey: "nav.users", module: "users" },
    ],
  },
];

function getNavGroups(role: UserRole | null): NavGroup[] {
  const financeChildren = role === "finance" ? financeNavSplit : [financeNavSingle];
  return [
    {
      id: "sales-finance",
      label: "Prodaja i Finansije",
      icon: DollarSign,
      children: [...salesFinanceBaseChildren, ...financeChildren],
    },
    ...navGroupsTail,
  ];
}

function getAllNavItems(role: UserRole | null): NavItem[] {
  const financeItems = role === "finance" ? financeNavSplit : [financeNavSingle];
  return [
    { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", module: "dashboard" },
    ...salesFinanceBaseChildren,
    ...financeItems,
    { to: "/material-orders", icon: Package, labelKey: "nav.materialOrders", module: "material-orders" },
    { to: "/suppliers", icon: Truck, labelKey: "nav.suppliers", module: "suppliers" },
    { to: "/vehicles", icon: Truck, labelKey: "nav.vehicles", module: "vehicles" },
    { to: "/workers", icon: Users, labelKey: "nav.workers", module: "workers" },
    { to: "/work-orders", icon: ClipboardList, labelKey: "nav.workOrders", module: "work-orders" },
    { to: "/field-reports", icon: FileText, labelKey: "nav.fieldReports", module: "field-reports" },
    { to: "/files", icon: FolderOpen, labelKey: "nav.files", module: "files" },
    { to: "/teams", icon: Users, labelKey: "nav.teams", module: "teams" },
    { to: "/users", icon: Shield, labelKey: "nav.users", module: "users" },
    { to: "/settings", icon: Settings, labelKey: "nav.settings", module: "settings" },
  ];
}

interface AppSidebarProps {
  open: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function isRouteActive(pathname: string, search: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  const [basePath, queryPart] = to.split("?");
  const pathMatches = pathname === basePath || pathname.startsWith(`${basePath}/`);
  if (!pathMatches) return false;
  if (!queryPart) return true;
  const wanted = new URLSearchParams(queryPart);
  const current = new URLSearchParams(search);
  for (const [k, v] of wanted.entries()) {
    if (current.get(k) !== v) return false;
  }
  return true;
}

export function AppSidebar({ open, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const locSearch = location.search;
  const { hasAccess, currentUserName, currentRole } = useRole();
  const { t } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const navGroups = useMemo(() => getNavGroups(currentRole), [currentRole]);
  const allNavItems = useMemo(() => getAllNavItems(currentRole), [currentRole]);

  const visibleItems = useMemo(
    () => allNavItems.filter((item) => hasAccess(item.module)),
    [allNavItems, hasAccess],
  );
  const visibleDashboard = hasAccess(dashboardItem.module);
  const visibleSettings = hasAccess(settingsItem.module);
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({ ...group, children: group.children.filter((child) => hasAccess(child.module)) }))
        .filter((group) => group.children.length > 0),
    [hasAccess, navGroups],
  );

  const activeGroupIds = useMemo(() => {
    return visibleGroups
      .filter((group) =>
        group.children.some((item) => isRouteActive(location.pathname, locSearch, item.to))
      )
      .map((group) => group.id);
  }, [location.pathname, locSearch, visibleGroups]);

  const toggleGroup = (groupId: string) => {
    if (activeGroupIds.includes(groupId)) return;
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <Hammer className="w-4 h-4 text-primary-foreground" />
        </div>
        {open && <span className="text-lg font-semibold text-sidebar-accent-foreground tracking-tight">Stolarija CRM</span>}
      </div>
      <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
        {open ? (
          <>
            {visibleDashboard && (
              <div className="mb-3">
                <p className="px-3 pb-2 text-xs font-medium uppercase tracking-[0.12em] text-sidebar-muted/90">
                  Glavno
                </p>
                <NavLink
                  to={dashboardItem.to}
                  onClick={onMobileClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] font-semibold transition-colors border border-transparent",
                    isRouteActive(location.pathname, locSearch, dashboardItem.to)
                      ? "bg-sidebar-accent text-sidebar-primary border-sidebar-border/80 shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/60">
                    <dashboardItem.icon className="w-4 h-4 shrink-0" />
                  </span>
                  <span>{t(dashboardItem.labelKey)}</span>
                </NavLink>
              </div>
            )}

            {visibleGroups.map((group) => {
              const isGroupActive = activeGroupIds.includes(group.id);
              const isExpanded = isGroupActive || !!expandedGroups[group.id];

              return (
                <div key={group.id} className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-[15px] font-semibold transition-colors border border-transparent",
                      "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/50">
                        <group.icon className="w-4 h-4 shrink-0" />
                      </span>
                      <span className="truncate">{group.label}</span>
                    </span>
                    {!isExpanded && <ChevronDown className="w-4 h-4 shrink-0" />}
                  </button>

                  <div
                    className={cn(
                      "grid transition-all duration-200 ease-out",
                      isExpanded ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0"
                    )}
                  >
                    <div className="overflow-hidden space-y-0.5 pl-2.5 pr-1">
                      {group.children.map((item) => {
                        const isActive = isRouteActive(location.pathname, locSearch, item.to);
                        return (
                          <NavLink
                            key={`${item.labelKey}-${item.to}`}
                            to={item.to}
                            onClick={onMobileClose}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-lg text-[14px] font-medium transition-colors",
                              isActive
                                ? "bg-sidebar-accent text-sidebar-primary shadow-sm"
                                : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            <item.icon className="w-[15px] h-[15px] shrink-0" />
                            <span>{t(item.labelKey)}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {visibleSettings && (
              <div className="pt-2 mt-2 border-t border-sidebar-border/80">
                <p className="px-3 pb-2 text-xs font-medium uppercase tracking-[0.12em] text-sidebar-muted/90">
                  Sistem
                </p>
                <NavLink
                  to={settingsItem.to}
                  onClick={onMobileClose}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] font-semibold transition-colors border border-transparent",
                    location.pathname.startsWith(settingsItem.to)
                      ? "bg-sidebar-accent text-sidebar-primary border-sidebar-border/80 shadow-sm"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/60">
                    <settingsItem.icon className="w-4 h-4 shrink-0" />
                  </span>
                  <span>{t(settingsItem.labelKey)}</span>
                </NavLink>
              </div>
            )}
          </>
        ) : (
          visibleItems.map((item) => {
            const isActive = isRouteActive(location.pathname, locSearch, item.to);
            return (
              <NavLink
                key={`${item.labelKey}-${item.to}`}
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
              </NavLink>
            );
          })
        )}
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
