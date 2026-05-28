import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, Bell, DollarSign, Truck, Calendar, AlertTriangle, CheckCheck, UserCog, LogOut, User, Clock, Settings, QrCode } from "lucide-react";
import { CameraBarcodeScanner } from "@/components/shared/CameraBarcodeScanner";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PwaDesktopRefreshButton } from "@/components/layout/PwaDesktopRefreshButton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  fetchNotifications,
  isPersistedNotificationId,
  markPersistedNotificationsRead,
  type Notification,
  type NotificationType,
} from "@/data/notifications";
import { useRole } from "@/contexts/RoleContext";
import { ROLE_CONFIG } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { performClientSignOut } from "@/lib/sign-out";
import { APP_SETTINGS_CACHE_KEY } from "@/lib/app-settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppHeaderProps {
  onToggleSidebar: () => void;
  onMobileMenuToggle: () => void;
}

const NOTIFICATIONS_PAGE_SIZE = 20;

const typeConfig: Record<NotificationType, { icon: React.ElementType; color: string }> = {
  overdue_payment: { icon: DollarSign, color: "text-destructive bg-destructive/10" },
  material_delivery: { icon: Truck, color: "text-info bg-info/10" },
  upcoming_installation: { icon: Calendar, color: "text-primary bg-primary/10" },
  complaint: { icon: AlertTriangle, color: "text-warning bg-warning/10" },
  job_status_change: { icon: Settings, color: "text-sky-600 bg-sky-500/10" },
  stale_job_status: { icon: Clock, color: "text-amber-600 bg-amber-500/10" },
};

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "upravo";
  if (mins < 60) return `pre ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `pre ${hrs}h`;
  return `pre ${Math.floor(hrs / 24)}d`;
}

export function AppHeader({ onToggleSidebar, onMobileMenuToggle }: AppHeaderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { currentRole, currentUserName, hasAccess } = useRole();
  const hideNotificationsBell =
    currentRole === "teren" || currentRole === "montaza" || currentRole === "production";
  const authUserId = useAuthStore(state => state.user?.id);
  const authReady = useAuthStore(state => state.authReady);
  const [settingsRefreshToken, setSettingsRefreshToken] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);

  const handleScanSuccess = (decodedText: string) => {
    try {
      const url = new URL(decodedText);
      const pathname = url.pathname;
      navigate(pathname);
      setScannerOpen(false);
    } catch (err) {
      console.warn("Nije validan URL:", err);
    }
  };
  const { data: baseNotifications = [] } = useQuery({
    queryKey: ["notifications", authUserId, settingsRefreshToken],
    queryFn: fetchNotifications,
    enabled: authReady && !!authUserId && !hideNotificationsBell,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
  const [readMap, setReadMap] = useState<Record<string, boolean>>({});
  const readStorageKey = useMemo(
    () => (authUserId ? `crm.notifications.read.${authUserId}` : null),
    [authUserId],
  );
  const hydratedReadStorageKeyRef = useRef<string | null>(null);

  const persistReadMap = (map: Record<string, boolean>) => {
    if (!readStorageKey) return;
    try {
      window.localStorage.setItem(readStorageKey, JSON.stringify(map));
    } catch {
      /* ignore localStorage errors */
    }
  };

  useEffect(() => {
    hydratedReadStorageKeyRef.current = null;
    if (!readStorageKey) {
      setReadMap({});
      return;
    }
    try {
      const raw = window.localStorage.getItem(readStorageKey);
      if (!raw) {
        setReadMap({});
        hydratedReadStorageKeyRef.current = readStorageKey;
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      setReadMap(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setReadMap({});
    }
    hydratedReadStorageKeyRef.current = readStorageKey;
  }, [readStorageKey]);

  const roleAllowedTypes = useMemo<Set<NotificationType> | null>(() => {
    if (currentRole === "procurement") {
      return new Set<NotificationType>(["material_delivery", "complaint"]);
    }
    if (currentRole === "office") {
      return new Set<NotificationType>([
        "overdue_payment",
        "upcoming_installation",
        "complaint",
        "job_status_change",
        "stale_job_status",
      ]);
    }
    return null;
  }, [currentRole]);

  const roleFilteredBaseNotifications = useMemo(() => {
    if (!roleAllowedTypes) return baseNotifications;
    return baseNotifications.filter((n) => roleAllowedTypes.has(n.type));
  }, [baseNotifications, roleAllowedTypes]);

  const items = useMemo(
    () => roleFilteredBaseNotifications.map(n => ({ ...n, read: readMap[n.id] ?? n.read })),
    [roleFilteredBaseNotifications, readMap],
  );
  const unreadCount = useMemo(() => items.reduce((count, n) => (n.read ? count : count + 1), 0), [items]);

  const [filter, setFilter] = useState<"all" | NotificationType>("all");
  const [visibleLimit, setVisibleLimit] = useState(NOTIFICATIONS_PAGE_SIZE);
  const { toast } = useToast();

  const notificationTabs = useMemo(() => {
    const all = [
      { key: "all" as const, label: "Sve" },
      { key: "overdue_payment" as const, label: "Plaćanja" },
      { key: "material_delivery" as const, label: "Isporuke" },
      { key: "upcoming_installation" as const, label: "Ugradnje" },
      { key: "complaint" as const, label: "Reklamacije" },
      { key: "job_status_change" as const, label: "Statusi" },
      { key: "stale_job_status" as const, label: "SLA" },
    ];
    if (!roleAllowedTypes) return all;
    return all.filter((t) => t.key === "all" || roleAllowedTypes.has(t.key));
  }, [roleAllowedTypes]);

  useEffect(() => {
    setVisibleLimit(NOTIFICATIONS_PAGE_SIZE);
  }, [filter]);

  useEffect(() => {
    if (!roleAllowedTypes) return;
    if (filter !== "all" && !roleAllowedTypes.has(filter)) {
      setFilter("all");
    }
  }, [filter, roleAllowedTypes]);

  useEffect(() => {
    const refresh = () => setSettingsRefreshToken((n) => n + 1);
    const onStorage = (event: StorageEvent) => {
      if (event.key === APP_SETTINGS_CACHE_KEY) refresh();
    };
    window.addEventListener("app-settings-updated", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("app-settings-updated", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const filtered = filter === "all" ? items : items.filter(n => n.type === filter);
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const hasMoreNotifications = filtered.length > visibleLimit;

  const handleLogout = async () => {
    const signOutError = await performClientSignOut(queryClient);
    navigate("/login", { replace: true });
    if (signOutError) {
      toast({
        title: "Odjava",
        description: signOutError.message,
        variant: "destructive",
      });
    }
  };

  const markAsRead = (notification: Notification) => {
    const { id } = notification;
    setReadMap(prev => {
      const next = { ...prev, [id]: true };
      if (hydratedReadStorageKeyRef.current === readStorageKey) {
        persistReadMap(next);
      }
      return next;
    });

    if (isPersistedNotificationId(id)) {
      void markPersistedNotificationsRead([id])
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
        .catch((err: unknown) => {
          console.warn("mark notification read:", err);
        });
    }
  };

  const markAllRead = () => {
    const snapshot = roleFilteredBaseNotifications
      .map(n => ({ ...n, read: readMap[n.id] ?? n.read }))
      .filter(n => !n.read);
    if (snapshot.length === 0) return;

    setReadMap(prev => {
      const next = { ...prev };
      for (const n of snapshot) next[n.id] = true;
      if (hydratedReadStorageKeyRef.current === readStorageKey) {
        persistReadMap(next);
      }
      return next;
    });

    const persistedIds = snapshot.filter(n => isPersistedNotificationId(n.id)).map(n => n.id);
    if (persistedIds.length > 0) {
      void markPersistedNotificationsRead(persistedIds)
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
        .catch((err: unknown) => {
          console.warn("mark all notifications read:", err);
        });
    }
  };

  const handleClick = (n: Notification) => {
    markAsRead(n);
    if (n.jobId) navigate(`/jobs/${n.jobId}`);
  };

  return (
    <header className="h-16 bg-card border-b border-border dark:border-b-white/[0.06] flex items-center justify-between px-2 sm:px-4 md:px-6 shrink-0 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Button variant="ghost" size="icon" className="hidden lg:flex" onClick={onToggleSidebar}>
          <Menu className="w-6 h-6" />
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMobileMenuToggle}>
          <Menu className="w-6 h-6" />
        </Button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <PwaDesktopRefreshButton />
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={() => setScannerOpen(true)}>
          <QrCode className="w-6 h-6" />
        </Button>
        <div className="hidden sm:flex items-center gap-2 mr-4">
          <div className="flex flex-col items-end">
            <span className="text-base font-semibold leading-tight text-foreground">{currentUserName}</span>
            <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mt-1">
              {currentRole && ROLE_CONFIG[currentRole]?.label}
            </span>
          </div>
        </div>

        {!hideNotificationsBell && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
              <PopoverContent className="w-[min(24rem,calc(100vw-1rem))] p-0" align="end" sideOffset={8}>
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold text-foreground text-sm">Obaveštenja</h3>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
                      <CheckCheck className="w-3 h-3" /> Označi sve kao pročitano
                    </button>
                  )}
                </div>

                <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
                  {notificationTabs.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setFilter(tab.key)}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-full font-medium transition-colors whitespace-nowrap",
                        filter === tab.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <ScrollArea className="h-80">
                  {filtered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">Nema obaveštenja</div>
                  ) : (
                    <>
                    <div className="divide-y divide-border pr-3 min-w-0">
                      {visibleFiltered.map(n => {
                        const config = typeConfig[n.type];
                        const Icon = config.icon;
                        return (
                          <button
                            key={n.id}
                            onClick={() => handleClick(n)}
                            className={cn(
                              "w-full min-w-0 flex gap-3 p-3 text-left transition-colors hover:bg-muted/50",
                              !n.read && "bg-primary/[0.03]",
                            )}
                          >
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", config.color)}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="flex items-start justify-between gap-2">
                                <p
                                  className={cn(
                                    "text-sm break-words leading-snug flex-1 min-w-0",
                                    !n.read ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
                                  )}
                                >
                                  {n.title}
                                </p>
                                {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />}
                              </div>
                              <p className="text-xs text-muted-foreground break-words leading-relaxed mt-0.5">
                                {n.description}
                              </p>
                              {n.jobNumber && (
                                <p className="text-[10px] text-primary font-medium mt-0.5 break-words">{n.jobNumber}</p>
                              )}
                              <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.timestamp)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  {hasMoreNotifications && (
                    <div className="border-t border-border p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-primary"
                        onClick={() => setVisibleLimit(prev => prev + NOTIFICATIONS_PAGE_SIZE)}
                      >
                        Prikaži više
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          (još {filtered.length - visibleLimit})
                        </span>
                      </Button>
                    </div>
                  )}
                    </>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:hover:bg-white/[0.06] dark:focus-visible:ring-zinc-500/35"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground ring-1 ring-zinc-300/70 dark:bg-white/[0.07] dark:text-foreground dark:ring-zinc-500/50">
                {currentUserName.split(" ").map(n => n[0]).join("")}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Moj nalog</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/profile")}>
              <User className="w-4 h-4 mr-2" /> Profil
            </DropdownMenuItem>
            {hasAccess("settings") && (
              <DropdownMenuItem onSelect={() => navigate("/settings")}>
                <Settings className="w-4 h-4 mr-2" /> Podešavanja
              </DropdownMenuItem>
            )}
            {currentRole === 'admin' && (
              <DropdownMenuItem onSelect={() => navigate("/users")}>
                <UserCog className="w-4 h-4 mr-2" /> Korisnici
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void handleLogout();
              }}
              className="text-destructive focus:bg-rose-100 focus:text-rose-900 dark:focus:bg-rose-950/70 dark:focus:text-rose-50 hover:bg-rose-100 hover:text-rose-900 dark:hover:bg-rose-950/60 dark:hover:text-rose-50"
            >
              <LogOut className="w-4 h-4 mr-2" /> Odjavi se
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {scannerOpen && (
        <CameraBarcodeScanner
          onScanSuccess={handleScanSuccess}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </header>
  );
}
