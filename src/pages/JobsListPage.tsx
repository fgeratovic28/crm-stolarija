import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Users, Search, Trash2, Briefcase, Edit2, Phone, Mail } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatusBadge, GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { OverduePaymentBadge } from "@/components/shared/OperationalBadges";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FilterBar, ActiveFilterChips, type FilterConfig } from "@/components/shared/FilterBar";
import { PageTransition } from "@/components/shared/PageTransition";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { useRole } from "@/contexts/RoleContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewJobModal } from "@/components/modals/NewJobModal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobs } from "@/hooks/use-jobs";
import { useCustomers } from "@/hooks/use-customers";
import { formatCurrencyBySettings, readAppSettingsCache } from "@/lib/app-settings";
import { cn } from "@/lib/utils";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import { getJobInstallationLocationDisplay } from "@/lib/job-installation-location";
import { isAdditionalWorksChildJob } from "@/lib/job-additional-works-display";
import { isJobListPreset, jobMatchesListPreset } from "@/lib/job-list-presets";
import { JOB_STATUS_CONFIG, type Job } from "@/types";

const filterConfigs: FilterConfig[] = [
  {
    key: "status", label: "Status",
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
  {
    key: "payment", label: "Plaćanje",
    options: [
      { value: "paid", label: "Plaćeno" }, { value: "unpaid", label: "Neplaćeno" },
      { value: "overdue", label: "Dospelo" },
    ],
  },
];

const VALID_STATUS_QUERY = new Set([
  "all",
  ...filterConfigs[0].options.map((o) => o.value),
]);

const VALID_PAYMENT_QUERY = new Set(["paid", "unpaid", "overdue"]);

const VALID_JOB_DETAILS_OPEN_TAB = new Set([
  "quotes",
  "finances",
  "work-orders",
  "field-reports",
  "files",
  "activities",
  "materials",
  "import-material",
]);

const LIST_PAGE_SIZE = 30;

export default function JobsListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFromUrl = searchParams.get("status");
  const initialStatus =
    statusFromUrl && VALID_STATUS_QUERY.has(statusFromUrl) ? statusFromUrl : "all";
  const paymentFromUrl = searchParams.get("payment");
  const initialPayment =
    paymentFromUrl && VALID_PAYMENT_QUERY.has(paymentFromUrl) ? paymentFromUrl : "all";
  const presetFromUrl = searchParams.get("preset");
  const initialPreset = isJobListPreset(presetFromUrl) ? presetFromUrl : null;
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({
    status: initialStatus,
    payment: initialPayment,
  });
  const [listPreset, setListPreset] = useState<typeof initialPreset>(initialPreset);
  const [activeTab, setActiveTab] = useState<"jobs" | "customers">(
    location.pathname.startsWith("/customers") ? "customers" : "jobs",
  );
  const [jobsVisibleLimit, setJobsVisibleLimit] = useState(LIST_PAGE_SIZE);
  const [customersVisibleLimit, setCustomersVisibleLimit] = useState(LIST_PAGE_SIZE);
  const { canPerformAction, hasAccess, currentRole } = useRole();
  const showCustomersTab = hasAccess("customers");
  const isProcurement = currentRole === "procurement";
  const showJobPhones = !isProcurement;
  const showJobMoney = !isProcurement;
  const openTabFromUrl = searchParams.get("openTab");
  const openTab =
    openTabFromUrl && VALID_JOB_DETAILS_OPEN_TAB.has(openTabFromUrl) ? openTabFromUrl : null;

  const jobDetailsHref = (jobId: string) =>
    openTab ? `/jobs/${jobId}?tab=${openTab}` : `/jobs/${jobId}`;

  useEffect(() => {
    if (activeTab === "customers" && !showCustomersTab) {
      setActiveTab("jobs");
    }
  }, [activeTab, showCustomersTab]);

  useEffect(() => {
    const fromPath = location.pathname.startsWith("/customers") ? "customers" : "jobs";
    if (fromPath === "customers" && !showCustomersTab) {
      setActiveTab("jobs");
      return;
    }
    setActiveTab(fromPath);
  }, [location.pathname, showCustomersTab]);

  useEffect(() => {
    if (!searchParams.get("tab")) return;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("tab");
        return p;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const raw = searchParams.get("status");
    const next =
      raw && VALID_STATUS_QUERY.has(raw) ? raw : "all";
    setFilters((prev) => (prev.status === next ? prev : { ...prev, status: next }));
  }, [searchParams]);

  useEffect(() => {
    const raw = searchParams.get("payment");
    const next = raw && VALID_PAYMENT_QUERY.has(raw) ? raw : "all";
    setFilters((prev) => (prev.payment === next ? prev : { ...prev, payment: next }));
  }, [searchParams]);

  useEffect(() => {
    const raw = searchParams.get("preset");
    const next = isJobListPreset(raw) ? raw : null;
    setListPreset((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  const { jobs = [], isLoading: loadingJobs, deleteJob } = useJobs();
  const { customers = [], isLoading: loadingCustomers, deleteCustomer } = useCustomers();
  const appSettings = readAppSettingsCache();

  const filteredJobs = jobs.filter((j) => {
    const phoneHay = showJobPhones ? jobPrimaryPhone(j).toLowerCase() : "";
    const matchSearch =
      !search ||
      j.customer.fullName.toLowerCase().includes(search.toLowerCase()) ||
      j.jobNumber.toLowerCase().includes(search.toLowerCase()) ||
      (showJobPhones && phoneHay.includes(search.toLowerCase()));
    const matchStatus =
      listPreset != null
        ? jobMatchesListPreset(listPreset, j.status)
        : filters.status === "all" || j.status === filters.status;
    const matchPayment = filters.payment === "all" ||
      (filters.payment === "paid" && j.unpaidBalance === 0) ||
      (filters.payment === "unpaid" && j.unpaidBalance > 0) ||
      (filters.payment === "overdue" &&
        j.unpaidBalance > 0 &&
        Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000) > appSettings.overdueDays);
    return matchSearch && matchStatus && matchPayment;
  });

  const filteredCustomers = customers.filter(c => 
    !customerSearch || 
    c.fullName.toLowerCase().includes(customerSearch.toLowerCase()) || 
    c.customerNumber.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.emails.some(e => e.toLowerCase().includes(customerSearch.toLowerCase())) ||
    c.phones.some(p => p.includes(customerSearch))
  );

  useEffect(() => {
    setJobsVisibleLimit(LIST_PAGE_SIZE);
  }, [search, filters, listPreset]);

  useEffect(() => {
    setCustomersVisibleLimit(LIST_PAGE_SIZE);
  }, [customerSearch]);

  const visibleJobs = useMemo(
    () => filteredJobs.slice(0, jobsVisibleLimit),
    [filteredJobs, jobsVisibleLimit],
  );
  const hasMoreJobs = filteredJobs.length > jobsVisibleLimit;

  const visibleCustomers = useMemo(
    () => filteredCustomers.slice(0, customersVisibleLimit),
    [filteredCustomers, customersVisibleLimit],
  );
  const hasMoreCustomers = filteredCustomers.length > customersVisibleLimit;

  const formatCurrency = (n: number) => formatCurrencyBySettings(n);

  /** Bez unete procene nema plaćanja u smislu klijenta — ne prikazuj kao „Plaćeno”. */
  const hasEstimatedPrice = (totalPrice: number) => totalPrice > 0.009;

  const handleTabChange = (value: string) => {
    const next = value === "customers" ? "customers" : "jobs";
    setActiveTab(next);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    if (key === "status") {
      setListPreset(null);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.delete("preset");
          if (value === "all") p.delete("status");
          else p.set("status", value);
          return p;
        },
        { replace: true },
      );
    }
    if (key === "payment") {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (value === "all") p.delete("payment");
          else p.set("payment", value);
          return p;
        },
        { replace: true },
      );
    }
  };

  const handleFilterReset = () => {
    setListPreset(null);
    setFilters({ status: "all", payment: "all" });
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("status");
        p.delete("payment");
        p.delete("preset");
        return p;
      },
      { replace: true },
    );
  };

  const loading = loadingJobs || loadingCustomers;

  if (loading) return <AppLayout title="Učitavanje..."><TableSkeleton rows={6} cols={6} /></AppLayout>;

  return (
    <AppLayout title={showCustomersTab ? "Kupci i Poslovi" : "Poslovi"}>
      <PageTransition>
        <Breadcrumbs items={[{ label: showCustomersTab ? "Kupci / Poslovi" : "Poslovi" }]} />
        <PageHeader
          title={showCustomersTab ? "Kupci / Poslovi" : "Poslovi"}
          description={activeTab === "jobs" ? `${filteredJobs.length} od ${jobs.length} poslova` : `${filteredCustomers.length} od ${customers.length} klijenta`}
          icon={Users}
          actions={
            canPerformAction("create_job") ? <NewJobModal /> : undefined
          }
        />

        <Tabs value={activeTab} className="space-y-4" onValueChange={handleTabChange}>
          <TabsList className={cn(!showCustomersTab && "hidden")}>
            <TabsTrigger value="jobs" className="flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Poslovi
            </TabsTrigger>
            {showCustomersTab && (
              <TabsTrigger value="customers" className="flex items-center gap-2">
                <Users className="w-4 h-4" /> Klijenti
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="jobs">
            <div className="bg-card rounded-xl border border-border dark:border-border/45 shadow-sm dark:shadow-none">
              <div className="p-3 sm:p-4 border-b border-border space-y-2 sm:space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Pretraži po imenu ili broju posla..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <FilterBar filters={filterConfigs} values={filters} onChange={handleFilterChange} onReset={handleFilterReset} />
                <ActiveFilterChips filters={filterConfigs} values={filters} onChange={handleFilterChange} />
              </div>

              {filteredJobs.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Briefcase}
                    title="Nema pronađenih poslova"
                    description={search || Object.values(filters).some(v => v !== "all") ? "Pokušajte da promenite filtere ili pretragu." : "Kreirajte prvi posao klikom na dugme iznad."}
                    actionLabel={search || Object.values(filters).some(v => v !== "all") ? "Resetuj filtere" : undefined}
                    onAction={search || Object.values(filters).some(v => v !== "all") ? () => { setSearch(""); handleFilterReset(); } : undefined}
                  />
                </div>
              ) : (
                <>
                  {/* Desktop table */}
                  <div className="overflow-x-auto hidden sm:block">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Posao #</th>
                          <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Kupac</th>
                          {showJobPhones && (
                            <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Telefon</th>
                          )}
                          <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Status</th>
                          {showJobMoney && (
                            <>
                              <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Procenjena cena</th>
                              <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">Neplaćeno</th>
                            </>
                          )}
                          <th className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => navigate(jobDetailsHref(job.id))}
                          >
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium text-primary">
                              <span className="inline-flex items-center gap-2 flex-wrap">
                                {job.jobNumber}
                                {isAdditionalWorksChildJob(job) ? (
                                  <GenericBadge variant="info" label="Dodatni radovi" />
                                ) : null}
                              </span>
                            </td>
                            <td className="px-4 lg:px-5 py-3">
                              <p className="text-sm font-medium text-foreground">{job.customer.fullName}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-48">{getJobInstallationLocationDisplay(job)}</p>
                            </td>
                            {showJobPhones && (
                              <td className="px-4 lg:px-5 py-3 text-sm text-muted-foreground">{jobPrimaryPhone(job) || "—"}</td>
                            )}
                            <td className="px-4 lg:px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={job.status} />
                                <OverduePaymentBadge job={job} />
                              </div>
                            </td>
                            {showJobMoney && (
                              <>
                                <td className="px-4 lg:px-5 py-3 text-sm font-medium text-foreground">
                                  {hasEstimatedPrice(job.totalPrice) ? formatCurrency(job.totalPrice) : "—"}
                                </td>
                                <td className="px-4 lg:px-5 py-3 text-sm font-medium">
                                  {job.unpaidBalance > 0 ? (
                                    <span className="text-destructive">{formatCurrency(job.unpaidBalance)}</span>
                                  ) : hasEstimatedPrice(job.totalPrice) ? (
                                    <span className="text-success">Plaćeno</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              </>
                            )}
                            <td className="px-4 lg:px-5 py-3">
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate(jobDetailsHref(job.id))}>Detalji</Button>
                                {canPerformAction("edit_job") && (
                                  <NewJobModal
                                    job={job}
                                    trigger={
                                      <Button variant="ghost" size="sm" className="text-xs">
                                        <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Izmeni
                                      </Button>
                                    }
                                  />
                                )}
                                {canPerformAction("delete_job") && (
                                  <ConfirmDialog
                                    trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>}
                                    title="Obrisati ovaj posao?"
                                    description={`Ovo će trajno obrisati ${job.jobNumber} za ${job.customer.fullName}. Sve povezane stavke će biti izgubljene.`}
                                    confirmLabel="Obriši posao"
                                    onConfirm={() => deleteJob.mutate(job.id)}
                                  />
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="sm:hidden divide-y divide-border">
                    {visibleJobs.map(job => (
                      <div key={job.id} className="p-4 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(jobDetailsHref(job.id))}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="text-sm font-medium text-primary inline-flex items-center gap-2 flex-wrap">
                              {job.jobNumber}
                              {isAdditionalWorksChildJob(job) ? (
                                <GenericBadge variant="info" label="Dodatni radovi" />
                              ) : null}
                            </p>
                            <p className="text-sm font-medium text-foreground">{job.customer.fullName}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={job.status} />
                            <OverduePaymentBadge job={job} />
                          </div>
                        </div>
                        {showJobMoney && (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{hasEstimatedPrice(job.totalPrice) ? formatCurrency(job.totalPrice) : "—"}</span>
                            <span
                              className={
                                job.unpaidBalance > 0
                                  ? "text-destructive font-medium"
                                  : hasEstimatedPrice(job.totalPrice)
                                    ? "text-success font-medium"
                                    : "text-muted-foreground font-medium"
                              }
                            >
                              {job.unpaidBalance > 0
                                ? formatCurrency(job.unpaidBalance)
                                : hasEstimatedPrice(job.totalPrice)
                                  ? "Plaćeno"
                                  : "—"}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {hasMoreJobs && (
                    <div className="border-t border-border p-3 flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setJobsVisibleLimit((prev) => prev + LIST_PAGE_SIZE)}
                      >
                        Prikaži više
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          (još {filteredJobs.length - jobsVisibleLimit})
                        </span>
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </TabsContent>

          {showCustomersTab && (
          <TabsContent value="customers">
            <div className="bg-card rounded-xl border border-border dark:border-border/45 shadow-sm dark:shadow-none">
              <div className="p-3 sm:p-4 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Pretraži po imenu, emailu ili telefonu..." className="pl-9" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Users}
                    title="Nema pronađenih klijenta"
                    description={customerSearch ? "Pokušajte da promenite pretragu." : "Još uvek nema unetih klijenta."}
                    actionLabel={customerSearch ? "Prikaži sve" : undefined}
                    onAction={customerSearch ? () => setCustomerSearch("") : undefined}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        {["Klijent #", "Ime / Firma", "Kontakt info", "Adresa", ""].map((h) => (
                          <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCustomers.map((customer) => (
                        <tr key={customer.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="px-4 lg:px-5 py-3 text-sm font-medium text-primary">{customer.customerNumber}</td>
                          <td className="px-4 lg:px-5 py-3">
                            <p className="text-sm font-medium text-foreground">{customer.fullName}</p>
                            <p className="text-xs text-muted-foreground">{customer.contactPerson}</p>
                          </td>
                          <td className="px-4 lg:px-5 py-3">
                            <div className="space-y-0.5">
                              {customer.phones[0] && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="w-3 h-3" /> {customer.phones[0]}</div>}
                              {customer.emails[0] && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="w-3 h-3" /> {customer.emails[0]}</div>}
                            </div>
                          </td>
                          <td className="px-4 lg:px-5 py-3 text-sm text-muted-foreground truncate max-w-xs">{customer.installationAddress}</td>
                          <td className="px-4 lg:px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/customers/${customer.id}/edit`)}><Edit2 className="w-4 h-4" /></Button>
                              <ConfirmDialog
                                trigger={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>}
                                title="Obrisati klijenta?"
                                description={`Ovo će trajno obrisati klijenta ${customer.fullName}. Svi povezani poslovi će takođe biti obrisani.`}
                                confirmLabel="Obriši klijenta"
                                onConfirm={() => deleteCustomer.mutate(customer.id)}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {hasMoreCustomers && (
                <div className="border-t border-border p-3 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCustomersVisibleLimit((prev) => prev + LIST_PAGE_SIZE)}
                  >
                    Prikaži više
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      (još {filteredCustomers.length - customersVisibleLimit})
                    </span>
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
          )}
        </Tabs>
      </PageTransition>
    </AppLayout>
  );
}
