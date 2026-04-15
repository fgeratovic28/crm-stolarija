import { useState } from "react";
import { Activity } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { ActivitiesTab } from "@/components/job-tabs/ActivitiesTab";
import { useAllActivities } from "@/hooks/use-activities";
import { useJobsListSimple } from "@/hooks/use-jobs";

export default function ActivitiesPage() {
  const [filters, setFilters] = useState<Record<string, string>>({ type: "all", job: "all" });

  const { data: activities = [], isLoading } = useAllActivities();

  const { data: jobs = [] } = useJobsListSimple();

  const filterConfigs: FilterConfig[] = [
    { key: "type", label: "Tip", options: [
      { value: "phone", label: "Telefon" }, { value: "email", label: "Email" },
      { value: "in_person", label: "Lično" }, { value: "viber", label: "Viber" },
    ]},
    { key: "job", label: "Posao", options: jobs.map(j => ({ value: j.id, label: j.job_number })) },
  ];

  const filtered = activities.filter(a => {
    const matchType = filters.type === "all" || a.type === filters.type;
    const matchJob = filters.job === "all" || a.jobId === filters.job;
    return matchType && matchJob;
  });

  return (
    <AppLayout>
      {isLoading ? <CardListSkeleton count={5} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Aktivnosti" }]} />
          <PageHeader title="Aktivnosti" description={`${filtered.length} komunikacija`} icon={Activity} />
          <div className="mb-4 space-y-2">
            <FilterBar filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} onReset={() => setFilters({ type: "all", job: "all" })} />
            <ActiveFilterChips filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} />
          </div>
          <ActivitiesTab activities={filtered} />
        </PageTransition>
      )}
    </AppLayout>
  );
}
