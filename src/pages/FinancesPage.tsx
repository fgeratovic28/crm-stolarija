import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DollarSign, TrendingDown, TrendingUp, Receipt, Download, FileDown, Package, Percent } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
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
import { useQueryClient } from "@tanstack/react-query";
import { useJobs, useFinancesData } from "@/hooks/use-jobs";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { MaterialOrderInvoiceEvidencijaDialog } from "@/components/modals/MaterialOrderInvoiceEvidencijaDialog";
import { useFiles } from "@/hooks/use-files";
import { mergeDefined } from "@/lib/merge-defined";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import { GenericBadge } from "@/components/shared/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MaterialOrder } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportModal } from "@/components/modals/ExportModal";
import { cn } from "@/lib/utils";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";

const filterConfigs: FilterConfig[] = [
  { key: "payment", label: "Plaćanje", options: [{ value: "paid", label: "Plaćeno" }, { value: "unpaid", label: "Neplaćeno" }] },
  {
    key: "status",
    label: "Status posla",
    options: [
      { value: "new", label: "Upit" },
      { value: "quote_sent", label: "Ponuda poslata" },
      { value: "final_quote_sent", label: "Poslata finalna ponuda" },
      { value: "final_quote_accepted_pending_payment", label: "Finalna prihvaćena / čeka uplatu" },
      { value: "accepted", label: JOB_STATUS_CONFIG.accepted.label },
      { value: "measuring", label: "Merenje" },
      { value: "measurement_processing", label: "Obrada mera" },
      { value: "ready_for_work", label: "Spremno za rad" },
      { value: "waiting_material", label: "Čeka materijal" },
      { value: "partial_in_production", label: "Delimično u proizvodnji" },
      { value: "in_production", label: "U proizvodnji" },
      { value: "scheduled", label: "Čeka ugradnju" },
      { value: "installation_in_progress", label: "Ugradnja u toku" },
      { value: "installation_done_unpaid", label: "Ugradnja završena / nije plaćeno" },
      { value: "completed", label: "Završen" },
      { value: "installation_problem", label: "Ugradnja – problem" },
      { value: "complaint", label: "Reklamacija" },
      { value: "service", label: "Servis" },
      { value: "canceled", label: "Otkazan" },
    ],
  },
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};
const piePalette = ["hsl(var(--primary))", "hsl(var(--muted-foreground))"];

const formatRSD = (v: number) => new Intl.NumberFormat("sr-RS").format(v) + " RSD";

const hasEstimatedPrice = (totalPrice: number) => totalPrice > 0.009;
const formatAxis = (v: number) => `${(v / 1000).toFixed(0)}k`;
const monthOptions = [
  { value: "all", label: "Svi meseci" },
  { value: "1", label: "Januar" },
  { value: "2", label: "Februar" },
  { value: "3", label: "Mart" },
  { value: "4", label: "April" },
  { value: "5", label: "Maj" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Avgust" },
  { value: "9", label: "Septembar" },
  { value: "10", label: "Oktobar" },
  { value: "11", label: "Novembar" },
  { value: "12", label: "Decembar" },
] as const;

type FinanceTab = "overview" | "payments" | "reports";
const PROCUREMENT_PAGE_SIZE = 10;
const JOBS_PAGE_SIZE = 15;

const VALID_FINANCE_TABS = new Set<FinanceTab>(["overview", "payments", "reports"]);
const VALID_FINANCE_PAYMENT = new Set(["paid", "unpaid"]);

export default function FinancesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { hasAccess, canPerformAction, currentRole } = useRole();
  const isProcurementRole = currentRole === "procurement";
  const isOfficeRole = currentRole === "office";
  const { uploadFile } = useFiles();
  const [activeTab, setActiveTab] = useState<FinanceTab>(() =>
    currentRole === "procurement" || currentRole === "office" ? "payments" : "overview",
  );
  const [procurementInvoiceOrder, setProcurementInvoiceOrder] = useState<MaterialOrder | null>(null);
  const [procurementFilter, setProcurementFilter] = useState<string>("all");

  const { jobs, isLoading: jobsLoading } = useJobs();
  const { data: summary, isLoading: summaryLoading } = useFinancesData();
  const {
    orders: financeMaterialOrders = [],
    isLoading: financeMoLoading,
    updateOrder: updateMaterialOrder,
  } = useMaterialOrders(undefined);
  const [filters, setFilters] = useState<Record<string, string>>({ payment: "all", status: "all" });
  const [paymentYear, setPaymentYear] = useState("all");
  const [paymentMonth, setPaymentMonth] = useState("all");
  const [paymentDateFrom, setPaymentDateFrom] = useState("");
  const [paymentDateTo, setPaymentDateTo] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [jobsPage, setJobsPage] = useState(1);
  const [procurementPendingPage, setProcurementPendingPage] = useState(1);
  const [procurementPaidPage, setProcurementPaidPage] = useState(1);

  useEffect(() => {
    const tabRaw = searchParams.get("tab");
    if (tabRaw && VALID_FINANCE_TABS.has(tabRaw as FinanceTab)) {
      setActiveTab(tabRaw as FinanceTab);
    }
    const paymentRaw = searchParams.get("payment");
    if (paymentRaw && VALID_FINANCE_PAYMENT.has(paymentRaw)) {
      setFilters((prev) => (prev.payment === paymentRaw ? prev : { ...prev, payment: paymentRaw }));
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    const next: FinanceTab =
      value === "payments" ? "payments" : value === "reports" ? "reports" : "overview";
    setActiveTab(next);
  };

  const showProcurementFinance = currentRole === "procurement" || hasAccess("material-orders");

  const loading = jobsLoading || summaryLoading || (showProcurementFinance && financeMoLoading);

  const filtered =
    jobs?.filter((j) => {
      const matchPayment =
        filters.payment === "all" ||
        (filters.payment === "paid" && j.unpaidBalance <= 0) ||
        (filters.payment === "unpaid" && j.unpaidBalance > 0);
      const matchStatus = filters.status === "all" || j.status === filters.status;
      return matchPayment && matchStatus;
    }) || [];

  const availablePaymentYears = Array.from(
    new Set(
      (jobs ?? [])
        .flatMap((j) => j.payments ?? [])
        .map((p) => new Date(p.date).getFullYear())
        .filter((y) => Number.isFinite(y))
        .sort((a, b) => b - a),
    ),
  );

  /**
   * „Porudžbine po nedostatku" iz magacina (express) nemaju novo plaćanje. One sa
   * `siteMissingFromInstallation` (hitno sa ugradnje) tretiraju se kao standardna nabavka u finansijama.
   */
  const procurementPending = useMemo(
    () =>
      showProcurementFinance
        ? financeMaterialOrders.filter(
            (o) =>
              (o.paymentStatus ?? "pending") !== "paid_advance" &&
              (o.isShortageOrder !== true || o.siteMissingFromInstallation === true),
          )
        : [],
    [financeMaterialOrders, showProcurementFinance],
  );
  const procurementPaidAdvance = useMemo(
    () =>
      showProcurementFinance
        ? financeMaterialOrders.filter(
            (o) =>
              o.paymentStatus === "paid_advance" &&
              (o.isShortageOrder !== true || o.siteMissingFromInstallation === true),
          )
        : [],
    [financeMaterialOrders, showProcurementFinance],
  );
  const procurementPendingTotalPages = Math.max(1, Math.ceil(procurementPending.length / PROCUREMENT_PAGE_SIZE));
  const procurementPaidTotalPages = Math.max(1, Math.ceil(procurementPaidAdvance.length / PROCUREMENT_PAGE_SIZE));
  const procurementPendingPageSafe = Math.min(procurementPendingPage, procurementPendingTotalPages);
  const procurementPaidPageSafe = Math.min(procurementPaidPage, procurementPaidTotalPages);
  const procurementPendingPaged = useMemo(() => {
    const start = (procurementPendingPageSafe - 1) * PROCUREMENT_PAGE_SIZE;
    return procurementPending.slice(start, start + PROCUREMENT_PAGE_SIZE);
  }, [procurementPending, procurementPendingPageSafe]);
  const procurementPaidPaged = useMemo(() => {
    const start = (procurementPaidPageSafe - 1) * PROCUREMENT_PAGE_SIZE;
    return procurementPaidAdvance.slice(start, start + PROCUREMENT_PAGE_SIZE);
  }, [procurementPaidAdvance, procurementPaidPageSafe]);

  useEffect(() => {
    setProcurementPendingPage(1);
  }, [procurementPending.length]);

  useEffect(() => {
    setProcurementPaidPage(1);
  }, [procurementPaidAdvance.length]);

  useEffect(() => {
    if (isProcurementRole) setActiveTab("payments");
  }, [isProcurementRole]);

  useEffect(() => {
    if (isOfficeRole && activeTab !== "payments") setActiveTab("payments");
  }, [activeTab, isOfficeRole]);

  const customerFiltered = filtered.filter((j) => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return true;
    const customerName = j.customer.fullName.toLowerCase();
    const jobNumber = j.jobNumber.toLowerCase();
    return customerName.includes(q) || jobNumber.includes(q);
  });

  const periodFiltered = customerFiltered.filter((j) => {
    const payments = j.payments ?? [];
    const hasPeriodFilter =
      paymentYear !== "all" || paymentMonth !== "all" || paymentDateFrom.trim() || paymentDateTo.trim();
    if (!hasPeriodFilter) return true;
    if (payments.length === 0) return false;

    return payments.some((p) => {
      const d = new Date(p.date);
      if (Number.isNaN(d.getTime())) return false;
      if (paymentYear !== "all" && d.getFullYear() !== Number(paymentYear)) return false;
      if (paymentMonth !== "all" && d.getMonth() + 1 !== Number(paymentMonth)) return false;
      if (paymentDateFrom && p.date < paymentDateFrom) return false;
      if (paymentDateTo && p.date > paymentDateTo) return false;
      return true;
    });
  });
  const jobsTotalPages = Math.max(1, Math.ceil(periodFiltered.length / JOBS_PAGE_SIZE));
  const jobsPageSafe = Math.min(jobsPage, jobsTotalPages);
  const periodFilteredPaged = useMemo(() => {
    const start = (jobsPageSafe - 1) * JOBS_PAGE_SIZE;
    return periodFiltered.slice(start, start + JOBS_PAGE_SIZE);
  }, [periodFiltered, jobsPageSafe]);

  useEffect(() => {
    setJobsPage(1);
  }, [filters, paymentYear, paymentMonth, paymentDateFrom, paymentDateTo, customerQuery]);

  const financiallyRelevantJobs = useMemo(
    () =>
      (jobs ?? []).filter((j) => {
        const price = Number(j.totalPrice) || 0;
        return price > 0.009 && j.status !== "new" && j.status !== "canceled";
      }),
    [jobs],
  );
  const jobsWithUnpaid = useMemo(
    () => financiallyRelevantJobs.filter((j) => (Number(j.unpaidBalance) || 0) > 0.009),
    [financiallyRelevantJobs],
  );
  const avgJobValue =
    financiallyRelevantJobs.length > 0 ? (summary?.totalRevenue ?? 0) / financiallyRelevantJobs.length : 0;
  const avgUnpaidPerOpenJob =
    jobsWithUnpaid.length > 0 ? (summary?.totalUnpaid ?? 0) / jobsWithUnpaid.length : 0;
  const collectionSplitData = useMemo(
    () => [
      { name: "Naplaćeno", value: Math.max(0, summary?.totalPaid ?? 0) },
      { name: "Preostalo", value: Math.max(0, summary?.totalUnpaid ?? 0) },
    ],
    [summary?.totalPaid, summary?.totalUnpaid],
  );
  const activeStatusData = useMemo(() => {
    const counts = new Map<string, number>();
    financiallyRelevantJobs.forEach((j) => {
      const status = String(j.status ?? "unknown");
      counts.set(status, (counts.get(status) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([status, count]) => ({
        status,
        label: JOB_STATUS_CONFIG[status as JobStatus]?.label ?? status,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [financiallyRelevantJobs]);

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
                ? isOfficeRole
                  ? "Pregled po poslovima — evidencija uplata"
                  : "Nabavka (fakture u avansu) i pregled po poslovima — evidencija uplata"
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

        <MaterialOrderInvoiceEvidencijaDialog
          order={procurementInvoiceOrder}
          open={procurementInvoiceOrder !== null}
          onOpenChange={(open) => {
            if (!open) setProcurementInvoiceOrder(null);
          }}
          userId={user?.id}
          canUpload={canPerformAction("upload_file")}
          uploadFile={uploadFile}
          onPersist={async (next) => {
            await updateMaterialOrder.mutateAsync(next);
            setProcurementInvoiceOrder(next);
          }}
          isSaving={updateMaterialOrder.isPending}
          onFilesChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["material-order-files"] });
          }}
        />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className={cn("grid w-full max-w-lg h-auto p-1", (isProcurementRole || isOfficeRole) ? "grid-cols-1" : "grid-cols-3")}>
            {!(isProcurementRole || isOfficeRole) && (
              <TabsTrigger value="overview" className="text-xs sm:text-sm">
                Finansije
              </TabsTrigger>
            )}
            <TabsTrigger value="payments" className="text-xs sm:text-sm">
              Plaćanja
            </TabsTrigger>
            {!(isProcurementRole || isOfficeRole) && (
              <TabsTrigger value="reports" className="text-xs sm:text-sm">
                Izveštaji
              </TabsTrigger>
            )}
          </TabsList>

          {!(isProcurementRole || isOfficeRole) && (
          <TabsContent value="overview" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard title="Ukupno procenjeno (interno)" value={formatRSD(summary?.estimatedTotal || 0)} icon={Receipt} />
              <StatCard title="Ukupno finansijski aktivno" value={formatRSD(summary?.totalRevenue || 0)} icon={Receipt} />
              <StatCard title="Ukupno naplaćeno" value={formatRSD(summary?.totalPaid || 0)} icon={TrendingUp} />
              <StatCard title="Preostalo za naplatu" value={formatRSD(summary?.totalUnpaid || 0)} icon={TrendingDown} />
              <StatCard title="Stopa naplate" value={`${summary?.collectionRate || 0}%`} icon={DollarSign} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                title="Finansijski aktivni poslovi"
                value={String(financiallyRelevantJobs.length)}
                icon={Receipt}
              />
              <StatCard
                title="Poslovi sa dugom"
                value={String(jobsWithUnpaid.length)}
                icon={TrendingDown}
              />
              <StatCard
                title="Prosečna vrednost posla"
                value={formatRSD(avgJobValue)}
                icon={DollarSign}
              />
              <StatCard
                title="Prosečan dug (otvoreni)"
                value={formatRSD(avgUnpaidPerOpenJob)}
                icon={TrendingUp}
              />
            </div>

            <div className="bg-card rounded-xl border border-border p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Percent className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground text-sm">PDV izveštaj</h2>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg border border-border bg-muted/15 p-4 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Ukupan izlazni PDV</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatRSD(summary?.totalOutgoingVatReport ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/15 p-4 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Ukupan ulazni PDV</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatRSD(summary?.totalIncomingVatReport ?? 0)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/15 p-4 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Trenutna PDV obaveza (procena)</p>
                  <p
                    className={`text-lg font-semibold tabular-nums ${
                      (summary?.estimatedVatLiability ?? 0) >= 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {formatRSD(summary?.estimatedVatLiability ?? 0)}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug">Izlazni − Ulazni</p>
                </div>
              </div>
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
              <div className="bg-card rounded-xl border border-border p-5">
                <h2 className="font-semibold text-foreground text-sm mb-4">Odnos naplate</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={collectionSplitData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={54}
                        outerRadius={88}
                        paddingAngle={2}
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                      >
                        {collectionSplitData.map((entry, idx) => (
                          <Cell key={entry.name} fill={piePalette[idx % piePalette.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatRSD(v), "Iznos"]} />
                      <Legend verticalAlign="bottom" height={24} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground text-sm mb-4">Aktivni poslovi po statusu</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeStatusData} margin={{ top: 5, right: 5, left: -10, bottom: 22 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-20} textAnchor="end" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Broj poslova"]} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
          )}

          <TabsContent value="payments" className="mt-0 space-y-6">
            {!isProcurementRole && (
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="space-y-1 md:col-span-2 lg:col-span-4">
                    <Label className="text-xs text-muted-foreground">Pretraga kupca / broja posla</Label>
                    <Input
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="Npr. Petrović ili JOB-2026-015"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Godina plaćanja</Label>
                    <Select value={paymentYear} onValueChange={setPaymentYear}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sve godine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Sve godine</SelectItem>
                        {availablePaymentYears.map((year) => (
                          <SelectItem key={year} value={String(year)}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Mesec plaćanja</Label>
                    <Select value={paymentMonth} onValueChange={setPaymentMonth}>
                      <SelectTrigger>
                        <SelectValue placeholder="Svi meseci" />
                      </SelectTrigger>
                      <SelectContent>
                        {monthOptions.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Kalendar od</Label>
                    <Input type="date" value={paymentDateFrom} onChange={(e) => setPaymentDateFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Kalendar do</Label>
                    <Input type="date" value={paymentDateTo} onChange={(e) => setPaymentDateTo(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPaymentYear("all");
                      setPaymentMonth("all");
                      setPaymentDateFrom("");
                      setPaymentDateTo("");
                      setCustomerQuery("");
                    }}
                  >
                    Reset perioda
                  </Button>
                </div>
              </div>
              {periodFiltered.length === 0 ? (
                <div className="p-6">
                  <EmptyState icon={DollarSign} title="Nema rezultata" description="Nema poslova za zadate filtere." />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto hidden sm:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          {["Posao #", "Kupac", "Status", "Procenjena cena", "Uplaćeno", "Neplaćeno"].map((h) => (
                            <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {periodFilteredPaged.map((j) => (
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
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium">
                              {hasEstimatedPrice(j.totalPrice) ? formatRSD(j.totalPrice) : "—"}
                            </td>
                            <td className="px-4 lg:px-5 py-3 text-sm">
                              {hasEstimatedPrice(j.totalPrice)
                                ? formatRSD(j.totalPrice - j.unpaidBalance)
                                : "—"}
                            </td>
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium">
                              {j.unpaidBalance > 0 ? (
                                <span className="text-destructive">{formatRSD(j.unpaidBalance)}</span>
                              ) : hasEstimatedPrice(j.totalPrice) ? (
                                <span className="text-success">Plaćeno</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sm:hidden divide-y divide-border">
                    {periodFilteredPaged.map((j) => (
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
                          <span>
                            Ukupno: {hasEstimatedPrice(j.totalPrice) ? formatRSD(j.totalPrice) : "—"}
                          </span>
                          <span
                            className={cn(
                              j.unpaidBalance > 0
                                ? "text-destructive font-medium"
                                : hasEstimatedPrice(j.totalPrice)
                                  ? "text-success"
                                  : "text-muted-foreground",
                            )}
                          >
                            {j.unpaidBalance > 0
                              ? formatRSD(j.unpaidBalance)
                              : hasEstimatedPrice(j.totalPrice)
                                ? "Plaćeno"
                                : "—"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {periodFiltered.length > JOBS_PAGE_SIZE ? (
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-xs text-muted-foreground">
                      <span>
                        Strana {jobsPageSafe}/{jobsTotalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={jobsPageSafe <= 1}
                          onClick={() => setJobsPage((p) => Math.max(1, p - 1))}
                        >
                          Prethodna
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={jobsPageSafe >= jobsTotalPages}
                          onClick={() => setJobsPage((p) => Math.min(jobsTotalPages, p + 1))}
                        >
                          Sledeća
                        </Button>
                      </div>
                    </div>
                    ) : null}
                </>
              )}
            </div>
            )}

            {showProcurementFinance ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Package className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground text-sm">Nabavka — evidencija fakture (avans)</h2>
                      <p className="text-xs text-muted-foreground mt-1">
                        Porudžbine materijala: broj fakture, iznos i prilog na R2. Klik na red otvara evidenciju; dugme
                        ispod označava avans plaćen.
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <Select value={procurementFilter} onValueChange={setProcurementFilter}>
                      <SelectTrigger className="w-auto min-w-[160px] h-8 text-xs">
                        <SelectValue placeholder="Status plaćanja" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Sve — status plaćanja</SelectItem>
                        <SelectItem value="unpaid">Neplaćeno</SelectItem>
                        <SelectItem value="paid">Plaćeno</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-5">
                    {(procurementFilter === "all" || procurementFilter === "unpaid") && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Neplaćene (čeka avans)
                      </h3>
                      {procurementPending.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">Nema porudžbina u ovom statusu.</p>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Referenca posla</TableHead>
                                  <TableHead>Dobavljač</TableHead>
                                  <TableHead className="text-right">Iznos fakture</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead className="w-[1%] whitespace-nowrap text-right">Akcija</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {procurementPendingPaged.map((o) => (
                                  <TableRow
                                    key={o.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => setProcurementInvoiceOrder(o)}
                                  >
                                    <TableCell className="font-medium text-primary">
                                      {o.job?.jobNumber ?? "—"}
                                    </TableCell>
                                    <TableCell>{o.supplier}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {o.invoiceAmount != null && Number.isFinite(o.invoiceAmount)
                                        ? formatCurrencyBySettings(o.invoiceAmount)
                                        : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <GenericBadge label="Neplaćeno" variant="warning" />
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={updateMaterialOrder.isPending}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void updateMaterialOrder.mutateAsync(
                                            mergeDefined(o, {
                                              paid: true,
                                              paymentStatus: "paid_advance",
                                            }) as MaterialOrder,
                                          );
                                        }}
                                      >
                                        Označi kao plaćeno
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
                            <span>
                              Strana {procurementPendingPageSafe}/{procurementPendingTotalPages}
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={procurementPendingPageSafe <= 1}
                                onClick={() => setProcurementPendingPage((p) => Math.max(1, p - 1))}
                              >
                                Prethodna
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={procurementPendingPageSafe >= procurementPendingTotalPages}
                                onClick={() =>
                                  setProcurementPendingPage((p) => Math.min(procurementPendingTotalPages, p + 1))
                                }
                              >
                                Sledeća
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    )}

                    {(procurementFilter === "all" || procurementFilter === "paid") && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Plaćene u avansu
                      </h3>
                      {procurementPaidAdvance.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">Još nema porudžbina sa statusom avans.</p>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-md border border-border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Referenca posla</TableHead>
                                  <TableHead>Dobavljač</TableHead>
                                  <TableHead className="text-right">Iznos fakture</TableHead>
                                  <TableHead>Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {procurementPaidPaged.map((o) => (
                                  <TableRow
                                    key={o.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => setProcurementInvoiceOrder(o)}
                                  >
                                    <TableCell className="font-medium text-primary">
                                      {o.job?.jobNumber ?? "—"}
                                    </TableCell>
                                    <TableCell>{o.supplier}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {o.invoiceAmount != null && Number.isFinite(o.invoiceAmount)
                                        ? formatCurrencyBySettings(o.invoiceAmount)
                                        : "—"}
                                    </TableCell>
                                    <TableCell>
                                      <GenericBadge label="Plaćeno u avansu" variant="success" />
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
                            <span>
                              Strana {procurementPaidPageSafe}/{procurementPaidTotalPages}
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={procurementPaidPageSafe <= 1}
                                onClick={() => setProcurementPaidPage((p) => Math.max(1, p - 1))}
                              >
                                Prethodna
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={procurementPaidPageSafe >= procurementPaidTotalPages}
                                onClick={() => setProcurementPaidPage((p) => Math.min(procurementPaidTotalPages, p + 1))}
                              >
                                Sledeća
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </TabsContent>

          {!(isProcurementRole || isOfficeRole) && (
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
          )}
        </Tabs>
      </PageTransition>
    </AppLayout>
  );
}
