import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DollarSign, TrendingDown, TrendingUp, Receipt, Download, FileDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageTransition } from "@/components/shared/PageTransition";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { OverduePaymentBadge } from "@/components/shared/OperationalBadges";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobs, useFinancesData } from "@/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { ExportModal } from "@/components/modals/ExportModal";
import { cn } from "@/lib/utils";

const filterConfigs: FilterConfig[] = [
  { key: "payment", label: "Plaćanje", options: [{ value: "paid", label: "Plaćeno" }, { value: "unpaid", label: "Neplaćeno" }] },
  {
    key: "status",
    label: "Status posla",
    options: [
      { value: "measuring", label: "Merenje" },
      { value: "in_production", label: "U proizvodnji" },
      { value: "scheduled", label: "Čeka ugradnju" },
      { value: "installation_in_progress", label: "Ugradnja u toku" },
      { value: "completed", label: "Završen" },
      { value: "complaint", label: "Reklamacija" },
      { value: "service", label: "Servis" },
    ],
  },
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const formatRSD = (v: number) => new Intl.NumberFormat("sr-RS").format(v) + " RSD";
const formatAxis = (v: number) => `${(v / 1000).toFixed(0)}k`;

type FinanceTab = "overview" | "payments" | "reports";

export default function FinancesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab");
  const activeTab: FinanceTab =
    rawTab === "payments" ? "payments" : rawTab === "reports" ? "reports" : "overview";

  const { jobs, isLoading: jobsLoading } = useJobs();
  const { data: summary, isLoading: summaryLoading } = useFinancesData();
  const [filters, setFilters] = useState<Record<string, string>>({ payment: "all", status: "all" });
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!searchParams.get("tab")) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("tab", "overview");
          return p;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  const handleTabChange = (value: string) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", value);
        return p;
      },
      { replace: true },
    );
  };

  const loading = jobsLoading || summaryLoading;

  const filtered =
    jobs?.filter((j) => {
      const matchPayment =
        filters.payment === "all" ||
        (filters.payment === "paid" && j.unpaidBalance <= 0) ||
        (filters.payment === "unpaid" && j.unpaidBalance > 0);
      const matchStatus = filters.status === "all" || j.status === filters.status;
      return matchPayment && matchStatus;
    }) || [];

  if (loading) {
    return (
      <AppLayout title="Finansije">
        <TableSkeleton rows={6} cols={6} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Finansije">
      <PageTransition>
        <Breadcrumbs items={[{ label: "Finansije" }]} />
        <PageHeader
          title="Finansije"
          description={
            activeTab === "overview"
              ? "KPI i trend naplate — brzi pregled stanja"
              : activeTab === "payments"
                ? "Pregled i filtriranje po poslovima (evidencija uplata na poslu)"
                : "Izvoz podataka u fajl (Excel / PDF preko dijaloga)"
          }
          icon={DollarSign}
          actions={
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Download className="w-4 h-4 mr-1.5" />
              Izvezi izveštaj
            </Button>
          }
        />
        <ExportModal open={exportOpen} onOpenChange={setExportOpen} />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3 h-auto p-1">
            <TabsTrigger value="overview" className="text-xs sm:text-sm">
              Finansije
            </TabsTrigger>
            <TabsTrigger value="payments" className="text-xs sm:text-sm">
              Plaćanja
            </TabsTrigger>
            <TabsTrigger value="reports" className="text-xs sm:text-sm">
              Izveštaji
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-0">
            <p className="text-sm text-muted-foreground -mt-2">
              Kartice i graf prikazuju iste agregate kao na kontrolnoj tabli; ovde su naglašeni trend (mesec) i stanje naplate.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard title="Ukupno fakturisano" value={formatRSD(summary?.totalRevenue || 0)} icon={Receipt} />
              <StatCard title="Ukupno naplaćeno" value={formatRSD(summary?.totalPaid || 0)} icon={TrendingUp} />
              <StatCard title="Preostalo za naplatu" value={formatRSD(summary?.totalUnpaid || 0)} icon={TrendingDown} />
              <StatCard title="Stopa naplate" value={`${summary?.collectionRate || 0}%`} icon={DollarSign} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border border-border p-5">
                <h2 className="font-semibold text-foreground text-sm mb-4">Mesečni pregled naplate</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary?.monthlyCollectionData || []} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={formatAxis} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatRSD(v), "Naplaćeno"]} />
                      <Bar dataKey="naplaćeno" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-card rounded-xl border border-border p-5 flex flex-col justify-center items-center text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <DollarSign className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Naplata u realnom vremenu</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Svi podaci su povučeni direktno iz baze uplata za svaki posao.
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="payments" className="mt-0">
            <div className="bg-card rounded-xl border border-border">
              <div className="p-4 sm:p-5 border-b border-border space-y-3">
                <h2 className="font-semibold text-foreground text-sm">Pregled po poslovima</h2>
                <FilterBar
                  filters={filterConfigs}
                  values={filters}
                  onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
                  onReset={() => setFilters({ payment: "all", status: "all" })}
                />
                <ActiveFilterChips
                  filters={filterConfigs}
                  values={filters}
                  onChange={(k, v) => setFilters((p) => ({ ...p, [k]: v }))}
                />
              </div>
              {filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState icon={DollarSign} title="Nema rezultata" description="Nema poslova za zadate filtere." />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto hidden sm:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          {["Posao #", "Kupac", "Status", "Fakturisano", "Uplaćeno", "Neplaćeno"].map((h) => (
                            <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((j) => (
                          <tr
                            key={j.id}
                            className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => navigate(`/jobs/${j.id}`)}
                          >
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium text-primary">{j.jobNumber}</td>
                            <td className="px-4 lg:px-5 py-3 text-sm text-muted-foreground">{j.customer.fullName}</td>
                            <td className="px-4 lg:px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={j.status} />
                                <OverduePaymentBadge job={j} />
                              </div>
                            </td>
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium">{formatRSD(j.totalPrice)}</td>
                            <td className="px-4 lg:px-5 py-3 text-sm">{formatRSD(j.totalPrice - j.unpaidBalance)}</td>
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium">
                              {j.unpaidBalance > 0 ? (
                                <span className="text-destructive">{formatRSD(j.unpaidBalance)}</span>
                              ) : (
                                <span className="text-success">Plaćeno</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sm:hidden divide-y divide-border">
                    {filtered.map((j) => (
                      <div
                        key={j.id}
                        className="p-4 cursor-pointer hover:bg-muted/30"
                        onClick={() => navigate(`/jobs/${j.id}`)}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <div>
                            <p className="text-sm font-medium text-primary">{j.jobNumber}</p>
                            <p className="text-sm font-medium text-foreground">{j.customer.fullName}</p>
                          </div>
                          <StatusBadge status={j.status} />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>Ukupno: {formatRSD(j.totalPrice)}</span>
                          <span className={cn(j.unpaidBalance > 0 ? "text-destructive font-medium" : "text-success")}>
                            {j.unpaidBalance > 0 ? formatRSD(j.unpaidBalance) : "Plaćeno"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="reports" className="mt-0 space-y-6">
            <p className="text-sm text-muted-foreground -mt-2">
              Ovde nema duplog grafa — dijagrame i KPI pogledajte na kartici <strong className="text-foreground">Finansije</strong>.
              Izveštaji služe da preuzmete podatke za arhivu, knjigovodstvo ili štampu.
            </p>
            <div className="bg-card rounded-xl border border-border p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <FileDown className="w-5 h-5 text-primary shrink-0" />
                    Izvoz u fajl
                  </div>
                  <p className="text-sm text-muted-foreground max-w-xl">
                    Otvara se dijalog za izbor opsega i formata. Tipično: lista poslova sa iznosima i uplatama, pogodno za Excel
                    ili dalju obradu — bez ponavljanja grafikona sa kartice Finansije.
                  </p>
                </div>
                <Button size="lg" className="shrink-0" onClick={() => setExportOpen(true)}>
                  <Download className="w-4 h-4 mr-2" />
                  Izvezi izveštaj
                </Button>
              </div>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 border-t border-border pt-4">
                <li>Za <strong className="text-foreground">vizuelni pregled</strong> (kartice, mesečni graf) koristite karticu Finansije.</li>
                <li>Za <strong className="text-foreground">red po poslu</strong> i filtre idite na Plaćanja.</li>
                <li>Za <strong className="text-foreground">fajl</strong> koristite dugme „Izvezi izveštaj“ (ovde ili u zaglavlju stranice).</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </PageTransition>
    </AppLayout>
  );
}
