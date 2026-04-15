import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, MapPin, Phone, Mail, Building2, DollarSign, Package,
  ClipboardList, Calendar, AlertTriangle, User, Copy,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatusBadge, GenericBadge } from "@/components/shared/StatusBadge";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { OverduePaymentBadge, DelayedDeliveryBadge, MissingDataWarning } from "@/components/shared/OperationalBadges";
import { PageTransition, TabTransition } from "@/components/shared/PageTransition";
import { DetailSkeleton } from "@/components/shared/Skeletons";
import { useRole } from "@/contexts/RoleContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useJobDetails, useJobs } from "@/hooks/use-jobs";
import { useJobRelatedData } from "@/hooks/use-job-data";
import { ActivitiesTab } from "@/components/job-tabs/ActivitiesTab";
import { FinancesTab } from "@/components/job-tabs/FinancesTab";
import { MaterialOrdersTab } from "@/components/job-tabs/MaterialOrdersTab";
import { WorkOrdersTab } from "@/components/job-tabs/WorkOrdersTab";
import { FieldReportsTab } from "@/components/job-tabs/FieldReportsTab";
import { FilesTab } from "@/components/job-tabs/FilesTab";
import { AddActivityModal } from "@/components/modals/AddActivityModal";
import { NewJobModal } from "@/components/modals/NewJobModal";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";
import { formatCurrencyBySettings } from "@/lib/app-settings";

export default function JobDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading: isLoadingJob, error } = useJobDetails(id);
  const { 
    activities: jobActivities, 
    payments: jobPayments, 
    materialOrders: jobMaterials, 
    workOrders: jobWorkOrders, 
    fieldReports: jobFieldReports, 
    files: jobFiles, 
    isLoading: isLoadingRelated 
  } = useJobRelatedData(id);
  const { updateJobStatus } = useJobs();
  const [activeTab, setActiveTab] = useState("overview");
  const { hasAccess, canPerformAction } = useRole();

  const handleStatusChange = (newStatus: JobStatus) => {
    if (id) {
      updateJobStatus.mutate({ id, status: newStatus });
    }
  };

  const isLoading = isLoadingJob || isLoadingRelated;

  if (isLoading) return <AppLayout title="Učitavanje..."><DetailSkeleton /></AppLayout>;

  if (error || !job) {
    return (
      <AppLayout title="Greška">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Posao nije pronađen</h2>
          <p className="text-muted-foreground mb-6">Traženi posao ne postoji ili nemate dozvolu da mu pristupite.</p>
          <Button onClick={() => navigate("/jobs")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Nazad na poslove
          </Button>
        </div>
      </AppLayout>
    );
  }


  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const pendingMaterials = jobMaterials.filter(m => m.deliveryStatus !== "delivered");
  const activeWorkOrders = jobWorkOrders.filter(w => w.status !== "completed" && w.status !== "canceled");
  const totalPaid = jobPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const paidPercent = job.totalPrice > 0 ? Math.round((totalPaid / job.totalPrice) * 100) : 0;

  const missingFields: string[] = [];
  if (!job.scheduledDate) missingFields.push("Datum ugradnje nije zakazan");
  if (job.unpaidBalance > 0 && jobPayments.length === 0) missingFields.push("Nema evidentiranih uplata");

  const copyJobNumber = () => {
    navigator.clipboard.writeText(job.jobNumber);
    toast.success("Broj posla kopiran");
  };

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[
          { label: "Kupci / Poslovi", href: "/jobs" },
          { label: `${job.jobNumber}` },
        ]} />

        {/* ── Header ── */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")} className="mb-3 -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4 mr-1" /> Nazad na listu poslova
          </Button>

          <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold text-foreground">{job.jobNumber}</h1>
                  <button onClick={copyJobNumber} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                  <Select onValueChange={handleStatusChange} value={job.status}>
                    <SelectTrigger className="h-7 w-fit bg-transparent border-none p-0 focus:ring-0">
                      <StatusBadge status={job.status} />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(JOB_STATUS_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>{config.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <OverduePaymentBadge job={job} />
                </div>
                <p className="text-base font-medium text-foreground">{job.customer.fullName}</p>
                <p className="text-sm text-muted-foreground">{job.summary}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" /> Kreirao: {job.createdBy?.name ?? "—"}
                  </span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Kreiran: {job.createdAt}</span>
                  {job.scheduledDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Zakazan: {job.scheduledDate}</span>}
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.jobInstallationAddress || job.customer.installationAddress}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {canPerformAction("edit_job") && (
                  <NewJobModal
                    job={job}
                    trigger={<Button variant="outline" size="sm">Izmeni</Button>}
                  />
                )}
                {canPerformAction("add_activity") && <AddActivityModal />}
              </div>
            </div>
          </div>
        </div>

        {/* ── KPI Strip ── */}
        {hasAccess("finances") && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3 mb-5">
            {[
              { icon: DollarSign, value: formatCurrency(job.totalPrice), label: "Ukupno", color: "text-foreground" },
              { icon: DollarSign, value: `${paidPercent}%`, label: "Naplaćeno", color: "text-success" },
              { icon: DollarSign, value: formatCurrency(job.unpaidBalance), label: "Preostalo", color: job.unpaidBalance > 0 ? "text-destructive" : "text-success" },
              { icon: Package, value: String(pendingMaterials.length), label: "Čeka materijal", color: pendingMaterials.length > 0 ? "text-warning" : "text-foreground" },
              { icon: ClipboardList, value: String(activeWorkOrders.length), label: "Aktivni nalozi", color: "text-info" },
              { icon: Calendar, value: job.scheduledDate || "—", label: "Zakazano", color: "text-foreground" },
            ].map((kpi, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-3 text-center">
                <kpi.icon className={`w-4 h-4 mx-auto mb-1 ${kpi.color}`} />
                <p className={`text-sm sm:text-base font-bold ${kpi.color} truncate`}>{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </div>
            ))}
          </div>
        )}

        {!hasAccess("finances") && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
            {[
              { icon: Package, value: String(pendingMaterials.length), label: "Čeka materijal", color: pendingMaterials.length > 0 ? "text-warning" : "text-foreground" },
              { icon: ClipboardList, value: String(activeWorkOrders.length), label: "Aktivni nalozi", color: "text-info" },
              { icon: Calendar, value: job.scheduledDate || "—", label: "Zakazano", color: "text-foreground" },
              { icon: MapPin, value: job.jobInstallationAddress || job.customer.installationAddress, label: "Lokacija", color: "text-foreground" },
            ].map((kpi, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-3 text-center">
                <kpi.icon className={`w-4 h-4 mx-auto mb-1 ${kpi.color}`} />
                <p className={`text-sm sm:text-base font-bold ${kpi.color} truncate`}>{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </div>
            ))}
          </div>
        )}

        {missingFields.length > 0 && <div className="mb-4"><MissingDataWarning fields={missingFields} /></div>}

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="bg-muted w-max sm:w-full justify-start">
              <TabsTrigger value="overview" className="text-xs sm:text-sm">Pregled</TabsTrigger>
              {hasAccess("activities") && <TabsTrigger value="activities" className="text-xs sm:text-sm">Aktivnosti <span className="hidden sm:inline ml-1">({jobActivities.length})</span></TabsTrigger>}
              {hasAccess("finances") && <TabsTrigger value="finances" className="text-xs sm:text-sm">Finansije</TabsTrigger>}
              {hasAccess("material-orders") && <TabsTrigger value="materials" className="text-xs sm:text-sm">Materijal <span className="hidden sm:inline ml-1">({jobMaterials.length})</span></TabsTrigger>}
              {hasAccess("work-orders") && <TabsTrigger value="work-orders" className="text-xs sm:text-sm">Nalozi <span className="hidden sm:inline ml-1">({jobWorkOrders.length})</span></TabsTrigger>}
              {hasAccess("field-reports") && <TabsTrigger value="field-reports" className="text-xs sm:text-sm">Teren <span className="hidden sm:inline ml-1">({jobFieldReports.length})</span></TabsTrigger>}
              {hasAccess("files") && <TabsTrigger value="files" className="text-xs sm:text-sm">Fajlovi <span className="hidden sm:inline ml-1">({jobFiles.length})</span></TabsTrigger>}
            </TabsList>
          </div>

          <TabsContent value="overview" forceMount={activeTab === "overview" ? true : undefined} hidden={activeTab !== "overview"}>
            <TabTransition key="overview">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Customer info */}
                <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                  <SectionHeader title="Podaci o kupcu" icon={Building2} />
                  <p className="text-xs text-muted-foreground mb-3">
                    Posao je vezan za klijenta <span className="text-foreground font-medium">{job.customer.fullName}</span> ({job.customer.customerNumber}).
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                    <div><span className="text-xs text-muted-foreground">Kupac #</span><p className="font-medium">{job.customer.customerNumber}</p></div>
                    <div><span className="text-xs text-muted-foreground">Kontakt osoba</span><p className="font-medium">{job.customer.contactPerson}</p></div>
                    {hasAccess("users") && (
                      <>
                        <div><span className="text-xs text-muted-foreground">PIB</span><p className="font-medium">{job.customer.pib}</p></div>
                        <div><span className="text-xs text-muted-foreground">Matični broj</span><p className="font-medium">{job.customer.registrationNumber}</p></div>
                      </>
                    )}
                  </div>
                  <div className="space-y-1.5 text-sm border-t border-border pt-3">
                    {job.customerPhone && (
                      <div className="flex items-center gap-2 text-foreground font-medium">
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        <span>Telefon za ovaj posao: {job.customerPhone}</span>
                      </div>
                    )}
                    {job.customer.phones
                      .filter((p) => p && (!job.customerPhone || p !== job.customerPhone))
                      .map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-muted-foreground">
                          <Phone className="w-3.5 h-3.5 shrink-0" /> <span>{p}</span>
                        </div>
                      ))}
                    {hasAccess("activities") && job.customer.emails.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3.5 h-3.5 shrink-0" /> <span>{e}</span></div>
                    ))}
                  </div>
                </div>

                {/* Addresses */}
                <div className="space-y-4">
                  <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-primary" />
                      <h4 className="font-semibold text-foreground text-sm">Adresa za fakturisanje</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{job.jobBillingAddress || job.customer.billingAddress}</p>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="w-4 h-4 text-primary" />
                      <h4 className="font-semibold text-foreground text-sm">Adresa ugradnje</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{job.jobInstallationAddress || job.customer.installationAddress}</p>
                  </div>
                </div>

                {job.quoteLines.length > 0 && (
                  <div className="bg-card rounded-xl border border-border p-4 sm:p-5 lg:col-span-2">
                    <SectionHeader
                      title="Stavke ponude"
                      subtitle={job.pricesIncludeVat ? "Cene sa PDV-om" : "Cene bez PDV-a (ukupno uključuje PDV)"}
                      icon={Package}
                    />
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-2">Opis</th>
                            <th className="py-2 pr-2 w-20">Kol.</th>
                            <th className="py-2 pr-2 w-28">Jed. cena</th>
                            <th className="py-2 text-right w-28">Iznos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {job.quoteLines.map((line) => (
                            <tr key={line.id} className="border-b border-border/60 last:border-0">
                              <td className="py-2 pr-2">{line.description}</td>
                              <td className="py-2 pr-2 text-muted-foreground">{line.quantity}</td>
                              <td className="py-2 pr-2 text-muted-foreground">
                                {formatCurrencyBySettings(line.unitPrice)}
                              </td>
                              <td className="py-2 text-right font-medium">
                                {formatCurrencyBySettings(line.quantity * line.unitPrice)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Pending materials */}
                {pendingMaterials.length > 0 && (
                  <div className="bg-card rounded-xl border border-warning/20 p-4 sm:p-5">
                    <SectionHeader title="Materijal na čekanju" subtitle={`${pendingMaterials.length} stavki`} icon={Package} />
                    <div className="space-y-2.5">
                      {pendingMaterials.map(m => (
                        <div key={m.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium capitalize">{m.materialType.replace("_", " ")}</span>
                            <span className="text-xs text-muted-foreground">— {m.supplier}</span>
                            <DelayedDeliveryBadge order={m} />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{m.expectedDelivery}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active work orders */}
                {activeWorkOrders.length > 0 && (
                  <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                    <SectionHeader title="Aktivni radni nalozi" subtitle={`${activeWorkOrders.length} naloga`} icon={ClipboardList} />
                    <div className="space-y-2.5">
                      {activeWorkOrders.map(w => (
                        <div key={w.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-2.5">
                          <div className="flex items-center gap-2">
                            <GenericBadge label={w.status === "in_progress" ? "U toku" : "Čeka"} variant={w.status === "in_progress" ? "info" : "warning"} />
                            <span className="truncate">{w.description.slice(0, 45)}{w.description.length > 45 ? "…" : ""}</span>
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{w.assignedTeamId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabTransition>
          </TabsContent>

          <TabsContent value="activities"><TabTransition key="activities"><ActivitiesTab activities={jobActivities} /></TabTransition></TabsContent>
          <TabsContent value="finances"><TabTransition key="finances"><FinancesTab job={job} payments={jobPayments} /></TabTransition></TabsContent>
          <TabsContent value="materials"><TabTransition key="materials"><MaterialOrdersTab orders={jobMaterials} jobId={id} /></TabTransition></TabsContent>
          <TabsContent value="work-orders"><TabTransition key="work-orders"><WorkOrdersTab jobId={id!} /></TabTransition></TabsContent>
          <TabsContent value="field-reports"><TabTransition key="field-reports"><FieldReportsTab reports={jobFieldReports} /></TabTransition></TabsContent>
          {hasAccess("files") && (
            <TabsContent value="files"><TabTransition key="files"><FilesTab files={jobFiles} /></TabTransition></TabsContent>
          )}
        </Tabs>
      </PageTransition>
    </AppLayout>
  );
}
