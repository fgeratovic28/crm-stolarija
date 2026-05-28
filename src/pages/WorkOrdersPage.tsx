import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, AlertTriangle, X, Calendar } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { useWorkOrders } from "@/hooks/use-work-orders";
import { useTeams } from "@/hooks/use-teams";
import { WorkOrdersTab } from "@/components/job-tabs/WorkOrdersTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatQueryError } from "@/lib/utils";
import { workOrderMatchesTypeFilter, workOrderTypeFilterOptions } from "@/lib/work-order-types-ui";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import {
  formatLocalDateYmd,
  isLocalDateTodayYmd,
  isWorkOrderScheduledOnDayYmd,
} from "@/lib/work-order-schedule-calendar";

const TEAM_FILTER_UNASSIGNED = "unassigned";

const DEFAULT_FILTERS = { status: "all", type: "all", team: "all" } as const;

export default function WorkOrdersPage() {
  const [searchParams] = useSearchParams();
  const { workOrders, isLoading, isError, error } = useWorkOrders();
  const { teams } = useTeams();
  const statusFromUrl = searchParams.get("status");
  const typeFromUrl = searchParams.get("type");
  const [filters, setFilters] = useState<Record<string, string>>(() => ({
    status:
      statusFromUrl === "pending" ||
      statusFromUrl === "in_progress" ||
      statusFromUrl === "completed" ||
      statusFromUrl === "canceled"
        ? statusFromUrl
        : DEFAULT_FILTERS.status,
    type: typeFromUrl && typeFromUrl !== "all" ? typeFromUrl : DEFAULT_FILTERS.type,
    team: DEFAULT_FILTERS.team,
  }));
  const [scheduleDate, setScheduleDate] = useState("");

  useEffect(() => {
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    setFilters((prev) => {
      const next = { ...prev };
      if (
        status === "pending" ||
        status === "in_progress" ||
        status === "completed" ||
        status === "canceled"
      ) {
        next.status = status;
      }
      if (type && type !== "all") {
        next.type = type;
      }
      return prev.status === next.status && prev.type === next.type ? prev : next;
    });
  }, [searchParams]);

  const filterConfigs = useMemo((): FilterConfig[] => {
    const teamOptions = [
      { value: TEAM_FILTER_UNASSIGNED, label: "Neraspoređeno" },
      ...(teams ?? [])
        .filter((t) => t.active)
        .sort((a, b) => a.name.localeCompare(b.name, "sr"))
        .map((t) => ({ value: t.id, label: t.name })),
    ];
    return [
      {
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Na čekanju" },
          { value: "in_progress", label: "U toku" },
          { value: "completed", label: "Završen" },
          { value: "canceled", label: "Otkazan" },
        ],
      },
      {
        key: "type",
        label: "Tip naloga",
        options: workOrderTypeFilterOptions(),
      },
      { key: "team", label: "Tim", options: teamOptions },
    ];
  }, [teams]);

  const resetAllFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setScheduleDate("");
  };

  if (isError) {
    return (
      <AppLayout title="Greška">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Greška pri učitavanju</h2>
          <p className="text-muted-foreground mb-2 max-w-lg break-words">{formatQueryError(error)}</p>
          <p className="text-muted-foreground text-sm mb-6">
            Proverite internet, Supabase URL/ključ u okruženju i da su migracije primenjene na projekat.
          </p>
          <Button onClick={() => window.location.reload()}>Pokušaj ponovo</Button>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) return <AppLayout><CardListSkeleton count={5} /></AppLayout>;

  const filtered = (workOrders || []).filter((w) => {
    const matchStatus = filters.status === "all" || w.status === filters.status;
    const matchType = workOrderMatchesTypeFilter(filters.type, w.type);
    const matchTeam =
      filters.team === "all"
        ? true
        : filters.team === TEAM_FILTER_UNASSIGNED
          ? !w.assignedTeamId
          : w.assignedTeamId === filters.team;
    const matchScheduleDate =
      !scheduleDate || isWorkOrderScheduledOnDayYmd(w.date, scheduleDate);
    return matchStatus && matchType && matchTeam && matchScheduleDate;
  });

  const scheduleDateLabel = scheduleDate
    ? formatDateByAppLanguage(scheduleDate) || scheduleDate
    : null;

  const pageDescription = scheduleDate
    ? `${filtered.length} zakazanih naloga za ${scheduleDateLabel}`
    : `${filtered.length} od ${workOrders?.length || 0} naloga`;

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: "Radni nalozi" }]} />
        <PageHeader title="Radni nalozi" description={pageDescription} icon={ClipboardList} />
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <FilterBar
              filters={filterConfigs}
              values={filters}
              onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
              onReset={resetAllFilters}
            />
            <div className="flex items-center gap-1.5">
              <Label htmlFor="wo-schedule-date" className="sr-only">
                Datum zakazivanja
              </Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="wo-schedule-date"
                  type="date"
                  className="h-8 w-auto min-w-[11.5rem] pl-8 text-xs"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  aria-label="Datum zakazivanja"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setScheduleDate(formatLocalDateYmd(new Date()))}
              >
                Danas
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ActiveFilterChips
              filters={filterConfigs}
              values={filters}
              onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
            />
            {scheduleDate && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                Datum: {scheduleDateLabel}
                {isLocalDateTodayYmd(scheduleDate) ? " (danas)" : ""}
                <button
                  type="button"
                  onClick={() => setScheduleDate("")}
                  className="hover:text-primary/70"
                  aria-label="Ukloni filter datuma"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        </div>
        <WorkOrdersTab workOrders={filtered} />
      </PageTransition>
    </AppLayout>
  );
}
