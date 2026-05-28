import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Calendar, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { ActivitiesTab } from "@/components/job-tabs/ActivitiesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAllActivities } from "@/hooks/use-activities";
import { useJobsListSimple } from "@/hooks/use-jobs";
import { isAutomatedActivityDescription } from "@/lib/activity-automation";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import {
  formatLocalDateYmd,
  isDateOnDayYmd,
  isLocalDateTodayYmd,
} from "@/lib/work-order-schedule-calendar";
import {
  consumeActivitiesListRestoreState,
  getAppMainScrollElement,
  saveActivitiesListState,
} from "@/lib/activities-list-session";
import { JOB_LIST_RETURN } from "@/lib/job-details-return";

const PER_PAGE_OPTIONS = [20, 50, 100];

const DEFAULT_FILTERS = { source: "all", type: "all", job: "all" } as const;

function readInitialActivitiesRestore() {
  return consumeActivitiesListRestoreState();
}

export default function ActivitiesPage() {
  const navigate = useNavigate();
  const initialRestore = useMemo(() => readInitialActivitiesRestore(), []);
  const pendingScrollRef = useRef(
    initialRestore
      ? { scrollTop: initialRestore.scrollTop, activityId: initialRestore.activityId }
      : null,
  );
  const skipFilterPageResetRef = useRef(!!initialRestore);
  const skipPerPageResetRef = useRef(!!initialRestore);

  const [filters, setFilters] = useState<Record<string, string>>(
    initialRestore?.filters ?? { ...DEFAULT_FILTERS },
  );
  const [page, setPage] = useState(initialRestore?.page ?? 1);
  const [perPage, setPerPage] = useState(
    initialRestore?.perPage && PER_PAGE_OPTIONS.includes(initialRestore.perPage)
      ? initialRestore.perPage
      : PER_PAGE_OPTIONS[0],
  );
  const [activityDate, setActivityDate] = useState(initialRestore?.activityDate ?? "");

  const { data: activities = [], isLoading } = useAllActivities();

  const { data: jobs = [] } = useJobsListSimple();

  const jobMeta = useMemo(() => {
    const m = new Map<string, { jobNumber: string; customerName: string }>();
    for (const j of jobs) {
      m.set(j.id, {
        jobNumber: j.job_number,
        customerName: j.customer?.fullName ?? "",
      });
    }
    return m;
  }, [jobs]);

  const filterConfigs: FilterConfig[] = [
    {
      key: "source",
      label: "Poreklo",
      options: [
        { value: "auto", label: "Automatski" },
        { value: "manual", label: "Korisnik" },
      ],
    },
    {
      key: "type",
      label: "Tip",
      options: [
        { value: "phone", label: "Telefon" },
        { value: "email", label: "Email" },
        { value: "in_person", label: "Lično" },
        { value: "viber", label: "Viber" },
      ],
    },
    {
      key: "job",
      label: "Posao",
      options: jobs.map((j) => ({
        value: j.id,
        label: j.customer?.fullName
          ? `${j.job_number} — ${j.customer.fullName}`
          : j.job_number,
      })),
    },
  ];

  const filtered = activities.filter((a) => {
    const auto = isAutomatedActivityDescription(a.description);
    const matchSource =
      filters.source === "all" ||
      (filters.source === "auto" ? auto : !auto);
    const matchType = filters.type === "all" || a.type === filters.type;
    const matchJob = filters.job === "all" || a.jobId === filters.job;
    const matchDate = !activityDate || isDateOnDayYmd(a.createdAt, activityDate);
    return matchSource && matchType && matchJob && matchDate;
  });

  const activityDateLabel = activityDate
    ? formatDateByAppLanguage(activityDate) || activityDate
    : null;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  useEffect(() => {
    if (skipFilterPageResetRef.current) {
      skipFilterPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [filters.source, filters.type, filters.job, activityDate]);

  useEffect(() => {
    if (skipPerPageResetRef.current) {
      skipPerPageResetRef.current = false;
      return;
    }
    setPage(1);
  }, [perPage]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleOpenJob = (activityId: string, jobId: string) => {
    const main = getAppMainScrollElement();
    saveActivitiesListState({
      scrollTop: main?.scrollTop ?? 0,
      page,
      perPage,
      filters,
      activityDate,
      activityId,
    });
    navigate(`/jobs/${jobId}`, { state: JOB_LIST_RETURN.activities });
  };

  const startIndex = (page - 1) * perPage;
  const endIndex = Math.min(filtered.length, startIndex + perPage);
  const paginatedActivities = filtered.slice(startIndex, startIndex + perPage);
  const hasPagination = filtered.length > perPage;
  const showRangeFrom = filtered.length === 0 ? 0 : startIndex + 1;

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (isLoading || !pending) return;

    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (pending.activityId) {
          const row = document.getElementById(`activity-row-${pending.activityId}`);
          if (row) {
            row.scrollIntoView({ block: "center", behavior: "auto" });
          } else {
            const main = getAppMainScrollElement();
            if (main && pending.scrollTop > 0) {
              main.scrollTop = pending.scrollTop;
            }
          }
        } else {
          const main = getAppMainScrollElement();
          if (main && pending.scrollTop > 0) {
            main.scrollTop = pending.scrollTop;
          }
        }
        pendingScrollRef.current = null;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [isLoading, page, perPage, filters, activityDate, paginatedActivities.length]);

  const visiblePages = (() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (page <= 4) {
      return [1, 2, 3, 4, 5, -1, totalPages];
    }
    if (page >= totalPages - 3) {
      return [1, -1, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, -1, page - 1, page, page + 1, -1, totalPages];
  })();

  return (
    <AppLayout>
      {isLoading ? <CardListSkeleton count={5} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Aktivnosti" }]} />
          <PageHeader title="Aktivnosti" description={`${filtered.length} komunikacija`} icon={Activity} />
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <FilterBar
                filters={filterConfigs}
                values={filters}
                onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
                onReset={() => {
                  setFilters({ ...DEFAULT_FILTERS });
                  setActivityDate("");
                }}
              />
              <div className="flex items-center gap-1.5">
                <Label htmlFor="activities-date" className="sr-only">
                  Datum aktivnosti
                </Label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="activities-date"
                    type="date"
                    className="h-8 w-auto min-w-[11.5rem] pl-8 text-xs"
                    value={activityDate}
                    onChange={(e) => setActivityDate(e.target.value)}
                    aria-label="Datum aktivnosti"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setActivityDate(formatLocalDateYmd(new Date()))}
                >
                  Danas
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ActiveFilterChips filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} />
              {activityDate && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  Datum: {activityDateLabel}
                  {isLocalDateTodayYmd(activityDate) ? " (danas)" : ""}
                  <button
                    type="button"
                    onClick={() => setActivityDate("")}
                    className="hover:text-primary/70"
                    aria-label="Ukloni filter datuma"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
          </div>
          <ActivitiesTab
            activities={paginatedActivities}
            totalCount={filtered.length}
            jobMeta={jobMeta}
            onOpenJob={handleOpenJob}
          />
          {hasPagination && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <label htmlFor="activities-per-page" className="text-sm text-muted-foreground">
                  Po stranici:
                </label>
                <select
                  id="activities-per-page"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                >
                  {PER_PAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-muted-foreground">
                  Prikazano {showRangeFrom}-{endIndex} od {filtered.length}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page === 1}
                >
                  Prethodna
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page === totalPages}
                >
                  Sledeća
                </Button>
                {visiblePages.map((pageNum, index) => {
                  if (pageNum === -1) {
                    return (
                      <span key={`ellipsis-${index}`} className="px-1 text-muted-foreground">
                        ...
                      </span>
                    );
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </PageTransition>
      )}
    </AppLayout>
  );
}
