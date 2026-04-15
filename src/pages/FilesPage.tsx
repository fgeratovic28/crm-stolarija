import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { FilesTab } from "@/components/job-tabs/FilesTab";
import { useAllFiles } from "@/hooks/use-files";
import { useJobsListSimple } from "@/hooks/use-jobs";

export default function FilesPage() {
  const [filters, setFilters] = useState<Record<string, string>>({ category: "all", job: "all" });

  const { data: files = [], isLoading } = useAllFiles();

  const { data: jobs = [] } = useJobsListSimple();

  const filterConfigs: FilterConfig[] = [
    { key: "category", label: "Kategorija", options: [
      { value: "offers", label: "Ponude" }, { value: "communication", label: "Komunikacija" },
      { value: "finance", label: "Finansije" }, { value: "supplier", label: "Dobavljač" },
      { value: "work_order", label: "Radni nalozi" }, { value: "field_photos", label: "Terenske foto." },
      { value: "reports", label: "Izveštaji" },
    ]},
    { key: "job", label: "Posao", options: jobs.map(j => ({ value: j.id, label: j.job_number })) },
  ];

  const filtered = files.filter(f => {
    const matchCategory = filters.category === "all" || f.category === filters.category;
    const matchJob = filters.job === "all" || f.jobId === filters.job;
    return matchCategory && matchJob;
  });

  return (
    <AppLayout>
      {isLoading ? <CardListSkeleton count={5} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Fajlovi" }]} />
          <PageHeader title="Fajlovi i dokumenta" description={`${filtered.length} fajlova u sistemu`} icon={FolderOpen} />
          <div className="mb-4 space-y-2">
            <FilterBar filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} onReset={() => setFilters({ category: "all", job: "all" })} />
            <ActiveFilterChips filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} />
          </div>
          <FilesTab files={filtered} />
        </PageTransition>
      )}
    </AppLayout>
  );
}
