import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Users, Search, Trash2, Briefcase, Plus, Edit2, Phone, Mail } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
import type { Job } from "@/types";

const filterConfigs: FilterConfig[] = [
  {
    key: "status", label: "Status",
    options: [
      { value: "new", label: "Upit" },
      { value: "quote_sent", label: "Ponuda poslata" },
      { value: "accepted", label: "Prihvaćeno" },
      { value: "measuring", label: "Merenje" },
      { value: "measurement_processing", label: "Obrada mera" },
      { value: "ready_for_work", label: "Spremno za rad" },
      { value: "waiting_material", label: "Čeka materijal" },
      { value: "in_production", label: "U proizvodnji" },
      { value: "scheduled", label: "Čeka ugradnju" },
      { value: "installation_in_progress", label: "Ugradnja u toku" },
      { value: "completed", label: "Završen" },
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

export default function JobsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = searchParams.get("status") || "all";
  const tabFromUrl = searchParams.get("tab");
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ status: initialStatus, payment: "all" });
  const [activeTab, setActiveTab] = useState<"jobs" | "customers">(
    tabFromUrl === "customers" ? "customers" : "jobs",
  );
  const { canPerformAction, hasAccess } = useRole();
  const showCustomersTab = hasAccess("customers");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "customers" && !showCustomersTab) {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("tab", "jobs");
          return p;
        },
        { replace: true },
      );
      setActiveTab("jobs");
      return;
    }
    setActiveTab(t === "customers" ? "customers" : "jobs");
  }, [searchParams, showCustomersTab, setSearchParams]);

  const { jobs = [], isLoading: loadingJobs, deleteJob } = useJobs();
  const { customers = [], isLoading: loadingCustomers, deleteCustomer } = useCustomers();
  const appSettings = readAppSettingsCache();

  const filteredJobs = jobs.filter((j) => {
    const phoneHay = jobPrimaryPhone(j).toLowerCase();
    const matchSearch =
      !search ||
      j.customer.fullName.toLowerCase().includes(search.toLowerCase()) ||
      j.jobNumber.toLowerCase().includes(search.toLowerCase()) ||
      phoneHay.includes(search.toLowerCase());
    const matchStatus = filters.status === "all" || j.status === filters.status;
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

  const formatCurrency = (n: number) => formatCurrencyBySettings(n);

  const handleTabChange = (value: string) => {
    const next = value === "customers" ? "customers" : "jobs";
    setActiveTab(next);
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "jobs") p.set("tab", "jobs");
        else p.set("tab", "customers");
        return p;
      },
      { replace: true },
    );
  };

  const handleFilterChange = (key: string, value: string) => setFilters(prev => ({ ...prev, [key]: value }));
  const handleFilterReset = () => setFilters({ status: "all", payment: "all" });

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
            <div className="flex gap-2">
              {activeTab === "customers" && canPerformAction("create_job") && (
                <Button size="sm" variant="outline" onClick={() => navigate("/customers/new")}>
                  <Plus className="w-4 h-4 mr-1" /> Novi klijent
                </Button>
              )}
              {canPerformAction("create_job") && <NewJobModal />}
            </div>
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
            <div className="bg-card rounded-xl border border-border">
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
                          {["Posao #", "Kupac", "Telefon", "Status", "Procenjena cena", "Neplaćeno", ""].map((h) => (
                            <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                            onClick={() => navigate(`/jobs/${job.id}`)}
                          >
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium text-primary">{job.jobNumber}</td>
                            <td className="px-4 lg:px-5 py-3">
                              <p className="text-sm font-medium text-foreground">{job.customer.fullName}</p>
                              <p className="text-xs text-muted-foreground truncate max-w-48">{job.customer.installationAddress}</p>
                            </td>
                            <td className="px-4 lg:px-5 py-3 text-sm text-muted-foreground">{jobPrimaryPhone(job) || "—"}</td>
                            <td className="px-4 lg:px-5 py-3">
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={job.status} />
                                <OverduePaymentBadge job={job} />
                              </div>
                            </td>
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium text-foreground">{formatCurrency(job.totalPrice)}</td>
                            <td className="px-4 lg:px-5 py-3 text-sm font-medium">
                              {job.unpaidBalance > 0 ? <span className="text-destructive">{formatCurrency(job.unpaidBalance)}</span> : <span className="text-success">Plaćeno</span>}
                            </td>
                            <td className="px-4 lg:px-5 py-3">
                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate(`/jobs/${job.id}`)}>Detalji</Button>
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
                    {filteredJobs.map(job => (
                      <div key={job.id} className="p-4 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/jobs/${job.id}`)}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <p className="text-sm font-medium text-primary">{job.jobNumber}</p>
                            <p className="text-sm font-medium text-foreground">{job.customer.fullName}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={job.status} />
                            <OverduePaymentBadge job={job} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{formatCurrency(job.totalPrice)}</span>
                          <span className={job.unpaidBalance > 0 ? "text-destructive font-medium" : "text-success font-medium"}>
                            {job.unpaidBalance > 0 ? formatCurrency(job.unpaidBalance) : "Plaćeno"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {showCustomersTab && (
          <TabsContent value="customers">
            <div className="bg-card rounded-xl border border-border">
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
                      {filteredCustomers.map((customer) => (
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
            </div>
          </TabsContent>
          )}
        </Tabs>
      </PageTransition>
    </AppLayout>
  );
}
