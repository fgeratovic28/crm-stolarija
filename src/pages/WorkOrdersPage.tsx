import { useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { useWorkOrders } from "@/hooks/use-work-orders";
import { WorkOrdersTab } from "@/components/job-tabs/WorkOrdersTab";
import { Button } from "@/components/ui/button";
import { formatQueryError } from "@/lib/utils";

const filterConfigs: FilterConfig[] = [
  { key: "status", label: "Status", options: [
    { value: "pending", label: "Na čekanju" }, { value: "in_progress", label: "U toku" },
    { value: "completed", label: "Završen" }, { value: "canceled", label: "Otkazan" },
  ]},
  { key: "type", label: "Tip naloga", options: [
    { value: "measurement", label: "Merenje" },
    { value: "measurement_verification", label: "Provera mera" },
    { value: "installation", label: "Ugradnja" },
    { value: "production", label: "Proizvodnja" },
    { value: "complaint", label: "Reklamacija" },
    { value: "service", label: "Servis" },
    { value: "site_visit", label: "Terenska poseta" },
    { value: "control_visit", label: "Kontrolna poseta" },
  ]},
  {
    key: "team", label: "Tim", options: [
      { value: "t1", label: "Tim Alfa" }, { value: "t2", label: "Tim Beta" },
      { value: "t3", label: "Proizvodnja" },
    ]
  },
];

export default function WorkOrdersPage() {
  const { workOrders, isLoading, isError, error } = useWorkOrders();
  const [filters, setFilters] = useState<Record<string, string>>({ status: "all", type: "all", team: "all" });

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

  const filtered = (workOrders || []).filter(w => {
    const matchStatus = filters.status === "all" || w.status === filters.status;
    const matchType = filters.type === "all" || w.type === filters.type;
    const matchTeam = filters.team === "all" || w.assignedTeamId === filters.team;
    return matchStatus && matchType && matchTeam;
  });

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: "Radni nalozi" }]} />
        <PageHeader title="Radni nalozi" description={`${filtered.length} od ${workOrders?.length || 0} naloga`} icon={ClipboardList} />
        <div className="mb-4 space-y-2">
          <FilterBar filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} onReset={() => setFilters({ status: "all", type: "all", team: "all" })} />
          <ActiveFilterChips filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} />
        </div>
        <WorkOrdersTab workOrders={filtered} />
      </PageTransition>
    </AppLayout>
  );
}
