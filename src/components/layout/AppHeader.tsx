import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Menu, Bell, Search, DollarSign, Truck, Calendar, AlertTriangle, CheckCheck, UserCog, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { fetchNotifications, type Notification, type NotificationType } from "@/data/notifications";
import { useRole } from "@/contexts/RoleContext";
import { ROLE_CONFIG } from "@/types";
import { supabase } from "@/lib/supabase";
import { useJobs } from "@/hooks/use-jobs";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
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

const typeConfig: Record<NotificationType, { icon: React.ElementType; color: string }> = {
  overdue_payment: { icon: DollarSign, color: "text-destructive bg-destructive/10" },
  material_delivery: { icon: Truck, color: "text-info bg-info/10" },
  upcoming_installation: { icon: Calendar, color: "text-primary bg-primary/10" },
  complaint: { icon: AlertTriangle, color: "text-warning bg-warning/10" },
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
  const navigate = useNavigate();
  const { currentRole, currentUserName } = useRole();
  const isFieldWorkerUi = currentRole === "montaza" || currentRole === "teren";
  const authUserId = useAuthStore(state => state.user?.id ?? "guest");
  const { jobs: jobsList } = useJobs();
  const searchJobs = jobsList ?? [];
  const { data: baseNotifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    staleTime: 60_000,
    enabled: !isFieldWorkerUi,
  });
  const [readMap, setReadMap] = useState<Record<string, boolean>>({});
  const items = useMemo(
    () => baseNotifications.map(n => ({ ...n, read: readMap[n.id] ?? n.read })),
    [baseNotifications, readMap],
  );
  const [filter, setFilter] = useState<"all" | NotificationType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { toast } = useToast();
  const unreadCount = useMemo(() => items.reduce((count, n) => (n.read ? count : count + 1), 0), [items]);
  const readStorageKey = useMemo(() => `crm.notifications.read.${authUserId}`, [authUserId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(readStorageKey);
      if (!raw) {
        setReadMap({});
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      if (parsed && typeof parsed === "object") {
        setReadMap(parsed);
      } else {
        setReadMap({});
      }
    } catch {
      setReadMap({});
    }
  }, [readStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(readStorageKey, JSON.stringify(readMap));
    } catch {
      /* ignore localStorage errors */
    }
  }, [readMap, readStorageKey]);

  const filtered = filter === "all" ? items : items.filter(n => n.type === filter);

  const handleLogout = async () => {
    useAuthStore.getState().setUser(null);
    navigate("/login");
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      toast({
        title: "Greška pri odjavi",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const markAsRead = (id: string) => {
    setReadMap(prev => ({ ...prev, [id]: true }));
  };

  const markAllRead = () => {
    setReadMap(prev => {
      const next = { ...prev };
      for (const n of items) next[n.id] = true;
      return next;
    });
  };

  const handleClick = (n: Notification) => {
    markAsRead(n.id);
    if (n.jobId) navigate(`/jobs/${n.jobId}`);
  };

  const searchResults = searchQuery.length >= 2
    ? searchJobs.filter(j =>
        j.customer.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.jobNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        j.summary.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 5)
    : [];

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="hidden lg:flex" onClick={onToggleSidebar}>
          <Menu className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMobileMenuToggle}>
          <Menu className="w-5 h-5" />
        </Button>
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <div className="hidden md:flex relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Pretraži poslove, kupce..."
                className="pl-9 w-72 bg-muted border-0"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchOpen(e.target.value.length >= 2); }}
              />
            </div>
          </PopoverTrigger>
          {searchResults.length > 0 && (
            <PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
              <div className="py-1">
                {searchResults.map(j => (
                  <button
                    key={j.id}
                    className="w-full flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                    onClick={() => { navigate(`/jobs/${j.id}`); setSearchOpen(false); setSearchQuery(""); }}
                  >
                    <span className="text-xs font-medium text-primary">{j.jobNumber}</span>
                    <span className="text-sm text-foreground">{j.customer.fullName}</span>
                    <span className="text-xs text-muted-foreground truncate">{j.summary}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          )}
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 mr-4">
          <div className="flex flex-col items-end">
            <span className="text-sm font-medium leading-none">{currentUserName}</span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mt-1">
              {currentRole && ROLE_CONFIG[currentRole]?.label}
            </span>
          </div>
        </div>

        {!isFieldWorkerUi && items.length > 0 && (
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
            <PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
              <div className="p-4 border-b border-border flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm">Obaveštenja</h3>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" /> Označi sve kao pročitano
                  </button>
                )}
              </div>

              <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
                {([
                  { key: "all" as const, label: "Sve" },
                  { key: "overdue_payment" as const, label: "Plaćanja" },
                  { key: "material_delivery" as const, label: "Isporuke" },
                  { key: "upcoming_installation" as const, label: "Ugradnje" },
                  { key: "complaint" as const, label: "Reklamacije" },
                ]).map(tab => (
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
                  <div className="divide-y divide-border pr-3">
                    {filtered.map(n => {
                      const config = typeConfig[n.type];
                      const Icon = config.icon;
                      return (
                        <button
                          key={n.id}
                          onClick={() => handleClick(n)}
                          className={cn(
                            "w-full flex gap-3 p-3 text-left transition-colors hover:bg-muted/50",
                            !n.read && "bg-primary/[0.03]"
                          )}
                        >
                          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5", config.color)}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className={cn("text-sm truncate", !n.read ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
                                {n.title}
                              </p>
                              {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.description}</p>
                            {n.jobNumber && <p className="text-[10px] text-primary font-medium mt-0.5">{n.jobNumber}</p>}
                            <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.timestamp)}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                {currentUserName.split(" ").map(n => n[0]).join("")}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Moj nalog</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <User className="w-4 h-4 mr-2" /> Profil
            </DropdownMenuItem>
            {currentRole === 'admin' && (
              <DropdownMenuItem onClick={() => navigate("/users")}>
                <UserCog className="w-4 h-4 mr-2" /> Korisnici
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
              <LogOut className="w-4 h-4 mr-2" /> Odjavi se
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
