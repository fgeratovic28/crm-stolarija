import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Search, X } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { FilesTab } from "@/components/job-tabs/FilesTab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAllFiles } from "@/hooks/use-files";
import { useJobsListSimple } from "@/hooks/use-jobs";
import { JOB_LIST_RETURN } from "@/lib/job-details-return";

const PER_PAGE_OPTIONS = [20, 50, 100];

const DEFAULT_FILTERS = { category: "all", job: "all" } as const;

export default function FilesPage() {
  const [filters, setFilters] = useState<Record<string, string>>({ ...DEFAULT_FILTERS });
  const [customerSearch, setCustomerSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(PER_PAGE_OPTIONS[0]);

  const { data: files = [], isLoading } = useAllFiles();

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
    { key: "category", label: "Kategorija", options: [
      { value: "offers", label: "Ponude" }, { value: "communication", label: "Komunikacija" },
      { value: "finance", label: "Finansije" }, { value: "supplier", label: "Dobavljač" },
      { value: "work_order", label: "Radni nalozi" }, { value: "field_photos", label: "Terenske foto." },
      { value: "reports", label: "Izveštaji" },
    ]},
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

  const customerSearchNorm = customerSearch.trim().toLowerCase();

  const filtered = files.filter((f) => {
    const matchCategory = filters.category === "all" || f.category === filters.category;
    const matchJob = filters.job === "all" || f.jobId === filters.job;
    const customerName = f.jobId ? jobMeta.get(f.jobId)?.customerName ?? "" : "";
    const matchCustomer =
      !customerSearchNorm || customerName.toLowerCase().includes(customerSearchNorm);
    return matchCategory && matchJob && matchCustomer;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  useEffect(() => {
    setPage(1);
  }, [filters.category, filters.job, customerSearch]);

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
  const paginatedFiles = filtered.slice(startIndex, startIndex + perPage);
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

  const hasActiveFilters =
    filters.category !== "all" ||
    filters.job !== "all" ||
    customerSearchNorm.length > 0;

  return (
    <AppLayout>
      {isLoading ? <CardListSkeleton count={5} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Fajlovi" }]} />
          <PageHeader title="Fajlovi i dokumenta" description={`${filtered.length} fajlova u sistemu`} icon={FolderOpen} />
          <div className="mb-4 space-y-2">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Pretraži po imenu kupca..."
                className="pl-9"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                aria-label="Pretraži po imenu kupca"
              />
            </div>
            <FilterBar
              filters={filterConfigs}
              values={filters}
              onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
              onReset={() => {
                setFilters({ ...DEFAULT_FILTERS });
                setCustomerSearch("");
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              <ActiveFilterChips
                filters={filterConfigs}
                values={filters}
                onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
              />
              {customerSearchNorm.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Kupac: {customerSearch.trim()}
                  <button
                    type="button"
                    onClick={() => setCustomerSearch("")}
                    className="hover:text-primary/70"
                    aria-label="Ukloni pretragu po kupcu"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
          </div>
          <FilesTab
            files={paginatedFiles}
            totalCount={filtered.length}
            jobMeta={jobMeta}
            jobListReturn={JOB_LIST_RETURN.files}
            emptyDescription={
              hasActiveFilters
                ? "Nema fajlova za trenutne filtere ili pretragu. Pokušajte da promenite kriterijume."
                : "Nema fajlova u sistemu. Otpremite prvi dokument."
            }
          />
          {hasPagination && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <label htmlFor="files-per-page" className="text-sm text-muted-foreground">
                  Po stranici:
                </label>
                <select
                  id="files-per-page"
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
