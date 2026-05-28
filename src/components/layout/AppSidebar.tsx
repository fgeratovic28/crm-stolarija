import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, Activity, DollarSign, Package, ClipboardList,
  FileText, FolderOpen, Shield, Settings, X, Truck, Briefcase, Layers, Wrench, MapPinned,
  Receipt,
  HardDrive,
  ScanBarcode,
  Building2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useRole } from "@/contexts/RoleContext";
import { useI18n } from "@/contexts/I18nContext";
import { type ModuleName } from "@/config/permissions";
import { ROLE_CONFIG, type UserRole } from "@/types";
import { TermoPlastCrmTitle } from "@/components/shared/TermoPlastCrmTitle";
import { useFilesStorageUsage } from "@/hooks/use-files-storage-usage";

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
  { to: "/customers", icon: Users, labelKey: "nav.customers", module: "customers" },
  { to: "/jobs", icon: Briefcase, labelKey: "nav.jobsOnly", module: "jobs" },
  { to: "/jobs-map", icon: MapPinned, labelKey: "nav.completedJobsMap", module: "jobs-map" },
  { to: "/activities", icon: Activity, labelKey: "nav.activities", module: "activities" },
];

/** Tri stavke samo za ulogu `finance`; ostali (admin, kancelarija, …) vide jednu „Finansije“. */
const financeNavSplit: NavItem[] = [
  { to: "/finances", icon: DollarSign, labelKey: "nav.financeOverview", module: "finances" },
  { to: "/finances", icon: Receipt, labelKey: "nav.financePayments", module: "finances" },
  { to: "/finances", icon: FileText, labelKey: "nav.financeReports", module: "finances" },
];

const financeNavSingle: NavItem = {
  to: "/finances",
  icon: DollarSign,
  labelKey: "nav.finances",
  module: "finances",
};

const procurementFinanceItem: NavItem = {
  to: "/finances",
  icon: Receipt,
  labelKey: "nav.financePayments",
  module: "finances",
};

const navGroupsTail: NavGroup[] = [
  {
    id: "resources-procurement",
    label: "Resursi i Nabavka",
    icon: Package,
    children: [
      { to: "/suppliers", icon: Building2, labelKey: "nav.suppliers", module: "suppliers" },
      { to: "/material-orders", icon: Package, labelKey: "nav.materialOrders", module: "material-orders" },
      { to: "/material-reception", icon: ScanBarcode, labelKey: "nav.materialReception", module: "material-reception" },
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
  const financeChildren =
    role === "finance" ? financeNavSplit : role === "procurement" ? [procurementFinanceItem] : [financeNavSingle];
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
  const financeItems =
    role === "finance" ? financeNavSplit : role === "procurement" ? [procurementFinanceItem] : [financeNavSingle];
  return [
    { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", module: "dashboard" },
    ...salesFinanceBaseChildren,
    ...financeItems,
    { to: "/material-orders", icon: Package, labelKey: "nav.materialOrders", module: "material-orders" },
    { to: "/material-reception", icon: ScanBarcode, labelKey: "nav.materialReception", module: "material-reception" },
    { to: "/suppliers", icon: Building2, labelKey: "nav.suppliers", module: "suppliers" },
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

const sidebarNavLinkClass = (isActive: boolean, showLabel: boolean) =>
  cn(
    "flex items-center rounded-lg font-medium transition-colors",
    showLabel ? "gap-3 px-3 py-2.5 text-[0.95rem] leading-snug" : "justify-center px-3 py-3 text-base",
    isActive
      ? "bg-primary/[0.09] text-primary dark:bg-sidebar-accent dark:text-sidebar-foreground"
      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );

function SidebarNavLink({
  item,
  label,
  isActive,
  showLabel,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  isActive: boolean;
  showLabel: boolean;
  onNavigate: () => void;
}) {
  const link = (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={sidebarNavLinkClass(isActive, showLabel)}
    >
      <item.icon className="w-5 h-5 shrink-0" aria-hidden />
      {showLabel ? <span className="truncate">{label}</span> : null}
    </NavLink>
  );

  if (showLabel) return link;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" align="center" className="font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function FilesStorageSidebarBlock({ open: sidebarOpen }: { open: boolean }) {
  const { currentRole } = useRole();
  const enabled = currentRole === "admin";
  const { data, isLoading, isError } = useFilesStorageUsage(enabled);
  if (!enabled) return null;

  const pct = data ? Math.min(100, data.percentFull) : 0;
  const over = data ? data.usedBytes > data.quotaBytes : false;
  const barColor = over || pct >= 95 ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-primary";

  return (
    <div className="px-3 py-2.5 shrink-0 border-b border-sidebar-border/80">
      {sidebarOpen ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-sidebar-muted">
              <HardDrive className="w-4 h-4 shrink-0" aria-hidden />
              Skladište
            </span>
            {isLoading ? (
              <span className="text-xs text-sidebar-muted">…</span>
            ) : isError ? (
              <span className="text-xs text-sidebar-muted">—</span>
            ) : data ? (
              <span
                className={cn(
                  "text-xs tabular-nums text-right max-w-[11rem] truncate",
                  over ? "text-destructive font-medium" : "text-sidebar-muted",
                )}
                title={`${data.usedLabel} od ${data.quotaLabel}`}
              >
                {data.usedLabel} / {data.quotaLabel}
              </span>
            ) : null}
          </div>
          {!isLoading && !isError && data && (
            <div
              className="h-2 w-full rounded-full bg-sidebar-accent overflow-hidden"
              title={`${Math.round(pct)}% kvote`}
            >
              <div className={cn("h-full rounded-full transition-all duration-300", barColor)} style={{ width: `${pct}%` }} />
            </div>
          )}
          {!isLoading && !isError && data && over && (
            <p className="text-xs text-destructive leading-snug">Zauzeto više od podešene kvote.</p>
          )}
        </div>
      ) : (
        <div
          className="flex justify-center px-0.5"
          title={data && !isLoading && !isError ? `${data.usedLabel} / ${data.quotaLabel}` : "Skladište"}
        >
          {!isLoading && !isError && data && (
            <div className="h-1.5 w-9 rounded-full bg-sidebar-accent overflow-hidden">
              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AppSidebar({ open, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const locSearch = location.search;
  const { hasAccess, currentUserName, currentRole } = useRole();
  const { t } = useI18n();
  /** Pun meni (labele + grupe); mobilni drawer uvek, desktop samo kad je sidebar otvoren. */
  const navExpanded = open || mobileOpen;

  const navGroups = useMemo(() => getNavGroups(currentRole), [currentRole]);
  const allNavItems = useMemo(() => getAllNavItems(currentRole), [currentRole]);

  const visibleItems = useMemo(
    () => allNavItems.filter((item) => hasAccess(item.module) && !(currentRole === "procurement" && item.module === "material-reception")),
    [allNavItems, currentRole, hasAccess],
  );
  const visibleDashboard = hasAccess(dashboardItem.module);
  const visibleSettings = hasAccess(settingsItem.module);
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          children: group.children.filter(
            (child) => hasAccess(child.module) && !(currentRole === "procurement" && child.module === "material-reception"),
          ),
        }))
        .filter((group) => group.children.length > 0),
    [currentRole, hasAccess, navGroups],
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="min-h-[4.25rem] flex min-w-0 items-center gap-3 px-4 border-b border-sidebar-border shrink-0 py-2">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-border/80 dark:bg-white dark:ring-white/20",
            navExpanded ? "p-1.5" : "h-9 w-9 p-1",
          )}
        >
          <img
            src="/logo.png"
            alt="Termoplast"
            className={cn(
              "object-contain",
              navExpanded ? "h-8 w-auto max-h-8 max-w-[min(100%,10rem)]" : "h-7 w-7",
            )}
            width={220}
            height={64}
            decoding="async"
          />
        </div>
        {navExpanded && (
          <div className="min-w-0 flex-1 overflow-hidden text-ellipsis">
            <TermoPlastCrmTitle className="text-lg" />
          </div>
        )}
      </div>
      <nav className="flex-1 py-3.5 px-3 space-y-0.5 overflow-y-auto">
        {navExpanded ? (
          <>
            {visibleDashboard && (
              <SidebarNavLink
                item={dashboardItem}
                label={t(dashboardItem.labelKey)}
                isActive={isRouteActive(location.pathname, locSearch, dashboardItem.to)}
                showLabel
                onNavigate={onMobileClose}
              />
            )}

            {visibleGroups.map((group) => (
              <section key={group.id} className="pt-2 first:pt-0.5" aria-label={group.label}>
                <p className="flex items-center gap-2.5 px-3 pb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-sidebar-muted">
                  <group.icon className="w-4 h-4 shrink-0" aria-hidden />
                  <span className="truncate">{group.label}</span>
                </p>
                <div className="space-y-0.5">
                  {group.children.map((item) => (
                    <SidebarNavLink
                      key={`${item.labelKey}-${item.to}`}
                      item={item}
                      label={t(item.labelKey)}
                      isActive={isRouteActive(location.pathname, locSearch, item.to)}
                      showLabel
                      onNavigate={onMobileClose}
                    />
                  ))}
                </div>
              </section>
            ))}

            {visibleSettings && (
              <div className="pt-2 mt-2 border-t border-sidebar-border/80">
                <SidebarNavLink
                  item={settingsItem}
                  label={t(settingsItem.labelKey)}
                  isActive={location.pathname.startsWith(settingsItem.to)}
                  showLabel
                  onNavigate={onMobileClose}
                />
              </div>
            )}
          </>
        ) : (
          visibleItems.map((item) => (
            <SidebarNavLink
              key={`${item.labelKey}-${item.to}`}
              item={item}
              label={t(item.labelKey)}
              isActive={isRouteActive(location.pathname, locSearch, item.to)}
              showLabel={false}
              onNavigate={onMobileClose}
            />
          ))
        )}
      </nav>
      <FilesStorageSidebarBlock open={navExpanded} />
      <div className="p-4 border-t border-sidebar-border shrink-0">
        {navExpanded && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-semibold text-sidebar-accent-foreground">
              {currentUserName.split(" ").map(n => n[0]).join("")}
            </div>
            <div className="min-w-0">
              <p className="text-base font-medium text-sidebar-foreground truncate">{currentUserName}</p>
              <p className="text-sm text-sidebar-muted truncate">
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
          open ? "w-72" : "w-[4.5rem]"
        )}
      >
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/50" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 w-[85vw] max-w-[20rem] bg-sidebar flex flex-col shadow-xl">
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
