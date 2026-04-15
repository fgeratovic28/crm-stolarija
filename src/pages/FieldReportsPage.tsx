import { FileText, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FieldReportsTab } from "@/components/job-tabs/FieldReportsTab";
import { useFieldReports } from "@/hooks/use-field-reports";
import { Button } from "@/components/ui/button";
import { formatQueryError } from "@/lib/utils";

export default function FieldReportsPage() {
  const { reports, isLoading, isError, error } = useFieldReports();

  if (isError) {
    return (
      <AppLayout title="Greška">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Greška pri učitavanju</h2>
          <p className="text-muted-foreground mb-2 max-w-lg break-words">{formatQueryError(error)}</p>
          <p className="text-muted-foreground text-sm mb-6">
            Ako je u pitanju šema baze, primenite migracije (npr. <code className="text-xs bg-muted px-1 rounded">field_reports.job_id</code>).
          </p>
          <Button onClick={() => window.location.reload()}>Pokušaj ponovo</Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      {isLoading ? <CardListSkeleton count={3} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Terenski izveštaji" }]} />
          <PageHeader title="Terenski izveštaji" description="Izveštaji sa ugradnji i terena" icon={FileText} />
          <FieldReportsTab reports={reports || []} />
        </PageTransition>
      )}
    </AppLayout>
  );
}
