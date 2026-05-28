import { Package } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { MaterialOrdersTab } from "@/components/job-tabs/MaterialOrdersTab";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { JOB_LIST_RETURN } from "@/lib/job-details-return";

export default function MaterialOrdersPage() {
  const { orders, isLoading } = useMaterialOrders();

  return (
    <AppLayout title="Narudžbine materijala">
      {isLoading ? <CardListSkeleton count={4} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Narudžbine materijala" }]} />
          <PageHeader title="Narudžbine materijala" description={`${orders?.length || 0} narudžbina`} icon={Package} />
          <MaterialOrdersTab orders={orders || []} jobListReturn={JOB_LIST_RETURN.materialOrders} />
        </PageTransition>
      )}
    </AppLayout>
  );
}
