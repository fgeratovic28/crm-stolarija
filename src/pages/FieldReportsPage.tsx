import { useEffect, useMemo, useState } from "react";
import { FileText, AlertTriangle, X, Calendar } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FieldReportsTab } from "@/components/job-tabs/FieldReportsTab";
import { useFieldReports } from "@/hooks/use-field-reports";
import { useJobsListSimple } from "@/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatQueryError } from "@/lib/utils";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import type { FieldReport } from "@/types";
import {
  formatLocalDateYmd,
  isDateOnDayYmd,
  isLocalDateTodayYmd,
} from "@/lib/work-order-schedule-calendar";
import { JOB_LIST_RETURN } from "@/lib/job-details-return";

const PER_PAGE_OPTIONS = [20, 50, 100];

function fieldReportOnDay(report: FieldReport, dayYmd: string): boolean {
  const candidate = report.arrivalDate ?? report.details?.arrivedAt;
  return isDateOnDayYmd(candidate, dayYmd);
}

export default function FieldReportsPage() {
  const { reports, isLoading, isError, error } = useFieldReports();
  const { data: jobs = [] } = useJobsListSimple();
  const [reportDate, setReportDate] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);

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

  const filtered = useMemo(() => {
    const list = reports ?? [];
    if (!reportDate) return list;
    return list.filter((r) => fieldReportOnDay(r, reportDate));
  }, [reports, reportDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  useEffect(() => {
    setPage(1);
  }, [reportDate]);

  useEffect(() => {
    setPage(1);
  }, [perPage]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const startIndex = (page - 1) * perPage;
  const endIndex = Math.min(filtered.length, startIndex + perPage);
  const paginatedReports = filtered.slice(startIndex, startIndex + perPage);
  const hasPagination = filtered.length > perPage;
  const showRangeFrom = filtered.length === 0 ? 0 : startIndex + 1;

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

  const reportDateLabel = reportDate
    ? formatDateByAppLanguage(reportDate) || reportDate
    : null;

  const pageDescription = reportDate
    ? `${filtered.length} izveštaj${filtered.length === 1 ? "" : "a"} za ${reportDateLabel}`
    : `${filtered.length} izveštaj${filtered.length === 1 ? "" : "a"} sa ugradnji i terena`;

  if (isError) {
    return (
      <AppLayout title="Greška">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Greška pri učitavanju</h2>
          <p className="text-muted-foreground mb-2 max-w-lg break-words">{formatQueryError(error)}</p>
          <p className="text-muted-foreground text-sm mb-6">
            Ako je u pitanju šema baze, primenite migracije (npr.{" "}
            <code className="text-xs bg-muted px-1 rounded">field_reports.job_id</code>).
          </p>
          <Button onClick={() => window.location.reload()}>Pokušaj ponovo</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {isLoading ? (
        <CardListSkeleton count={3} />
      ) : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Terenski izveštaji" }]} />
          <PageHeader title="Terenski izveštaji" description={pageDescription} icon={FileText} />
          <div className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="field-report-date" className="sr-only">
                Datum izveštaja
              </Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="field-report-date"
                  type="date"
                  className="h-8 w-auto min-w-[11.5rem] pl-8 text-xs"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                  aria-label="Datum izveštaja"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setReportDate(formatLocalDateYmd(new Date()))}
              >
                Danas
              </Button>
              {reportDate && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => setReportDate("")}
                >
                  <X className="w-3 h-3 mr-1" /> Resetuj filtere
                </Button>
              )}
            </div>
            {reportDate && (
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  Datum: {reportDateLabel}
                  {isLocalDateTodayYmd(reportDate) ? " (danas)" : ""}
                  <button
                    type="button"
                    onClick={() => setReportDate("")}
                    className="hover:text-primary/70"
                    aria-label="Ukloni filter datuma"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}
          </div>
          <FieldReportsTab
            reports={paginatedReports}
            totalCount={filtered.length}
            jobMeta={jobMeta}
            jobListReturn={JOB_LIST_RETURN.fieldReports}
          />
          {hasPagination && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <label htmlFor="field-reports-per-page" className="text-sm text-muted-foreground">
                  Po stranici:
                </label>
                <select
                  id="field-reports-per-page"
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
