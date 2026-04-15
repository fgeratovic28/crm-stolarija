import { useState } from "react";
import { Package } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { MaterialOrdersTab } from "@/components/job-tabs/MaterialOrdersTab";
import { useMaterialOrders } from "@/hooks/use-material-orders";

const filterConfigs: FilterConfig[] = [
  { key: "delivery", label: "Status isporuke", options: [
    { value: "pending", label: "Na čekanju" }, { value: "shipped", label: "Na putu" },
    { value: "delivered", label: "Isporučeno" }, { value: "partial", label: "Delimično" },
  ]},
  { key: "paid", label: "Plaćanje", options: [
    { value: "paid", label: "Plaćeno" }, { value: "unpaid", label: "Neplaćeno" },
  ]},
  { key: "material", label: "Vrsta materijala", options: [
    { value: "glass", label: "Staklo" }, { value: "profile", label: "Profil" },
    { value: "hardware", label: "Okov" }, { value: "shutters", label: "Roletne" },
  ]},
];

export default function MaterialOrdersPage() {
  const { orders, isLoading } = useMaterialOrders();
  const [filters, setFilters] = useState<Record<string, string>>({ delivery: "all", paid: "all", material: "all" });

  const filtered = orders?.filter(m => {
    const matchDelivery = filters.delivery === "all" || m.deliveryStatus === filters.delivery;
    const matchPaid = filters.paid === "all" || (filters.paid === "paid" ? m.paid : !m.paid);
    const matchMaterial = filters.material === "all" || m.materialType === filters.material;
    return matchDelivery && matchPaid && matchMaterial;
  }) || [];

  return (
    <AppLayout title="Narudžbine materijala">
      {isLoading ? <CardListSkeleton count={4} /> : (
        <PageTransition>
          <Breadcrumbs items={[{ label: "Narudžbine materijala" }]} />
          <PageHeader title="Narudžbine materijala" description={`${filtered.length} od ${orders?.length || 0} narudžbina`} icon={Package} />
          <div className="mb-4 space-y-2">
            <FilterBar filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} onReset={() => setFilters({ delivery: "all", paid: "all", material: "all" })} />
            <ActiveFilterChips filters={filterConfigs} values={filters} onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))} />
          </div>
          <MaterialOrdersTab orders={filtered} />
        </PageTransition>
      )}
    </AppLayout>
  );
}
