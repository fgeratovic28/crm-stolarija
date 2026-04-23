import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Briefcase, AlertTriangle, Package, Calendar, MessageSquare, DollarSign, TrendingUp, Truck, Download,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { OverduePaymentBadge, AttentionIndicator } from "@/components/shared/OperationalBadges";
import { PageTransition, StaggerContainer, StaggerItem } from "@/components/shared/PageTransition";
import { DashboardSkeleton } from "@/components/shared/Skeletons";
import { useRole } from "@/contexts/RoleContext";
import { useJobs, useFinancesData, useDashboardStats } from "@/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";
import { ExportModal } from "@/components/modals/ExportModal";
import { FieldTeamDashboard } from "@/components/dashboard/FieldTeamDashboard";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { formatCurrencyBySettings, formatDateByAppLanguage, readAppSettingsCache } from "@/lib/app-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { labelMaterialType } from "@/lib/activity-labels";

const STATUS_COLORS: Record<string, string> = {
  new: "hsl(215, 16%, 47%)",
  quote_sent: "hsl(199, 89%, 48%)",
  accepted: "hsl(142, 71%, 40%)",
  measuring: "hsl(152, 57%, 40%)",
  measurement_processing: "hsl(262, 83%, 58%)",
  ready_for_work: "hsl(175, 70%, 38%)",
  waiting_material: "hsl(38, 92%, 48%)",
  in_production: "hsl(38, 92%, 48%)",
  scheduled: "hsl(239, 84%, 58%)",
  installation_in_progress: "hsl(221, 83%, 53%)",
  completed: "hsl(142, 71%, 40%)",
  complaint: "hsl(0, 72%, 51%)",
  service: "hsl(220, 9%, 46%)",
  canceled: "hsl(220, 9%, 46%)",
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasAccess, currentRole } = useRole();
  const [exportOpen, setExportOpen] = useState(false);
  const { jobs = [], isLoading: loadingJobs, error: jobsError, refetch: refetchJobs } = useJobs();
  const financesQuery = useFinancesData();
  const statsQuery = useDashboardStats();
  const financesData = financesQuery.data;
  const dashboardStats = statsQuery.data;

  const loading = loadingJobs || financesQuery.isLoading || statsQuery.isLoading;

  const appSettings = readAppSettingsCache();
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);

  const pipelineStatuses: JobStatus[] = [
    "accepted",
    "measuring",
    "measurement_processing",
    "ready_for_work",
    "waiting_material",
    "in_production",
    "installation_in_progress",
  ];
  const stats = {
    activeJobs: jobs.filter(j => j.status !== "completed" && j.status !== "canceled").length,
    inProgress: jobs.filter(j => pipelineStatuses.includes(j.status)).length,
    unpaidJobs: jobs.filter(j => j.unpaidBalance > 0).length,
    pendingOrders: dashboardStats?.pendingOrders || 0,
    upcomingInstallations: dashboardStats?.upcomingInstallations || 0,
    complaints: jobs.filter(j => j.status === "complaint" || j.status === "service").length,
    totalRevenue: financesData?.totalRevenue || 0,
    totalUnpaid: financesData?.totalUnpaid || 0,
  };

  const overdueJobs = jobs.filter(
    (j) =>
      j.unpaidBalance > 0 &&
      Math.floor((Date.now() - new Date(j.createdAt).getTime()) / 86400000) > appSettings.overdueDays
  );
  
  const lateDeliveriesCount = dashboardStats?.lateDeliveriesCount || 0;
  const complaintAttentionCount = jobs.filter(j => j.status === "complaint").length;

  function getStatusDistribution() {
    const counts: Record<string, number> = {};
    jobs.forEach(j => {
      counts[j.status] = (counts[j.status] || 0) + 1;
    });
    return Object.entries(counts).map(([status, count]) => ({
      name: JOB_STATUS_CONFIG[status as JobStatus]?.label || status,
      value: count,
      color: STATUS_COLORS[status] || "hsl(220, 9%, 46%)",
    }));
  }

  if (loading) return <AppLayout title="Učitavanje..."><DashboardSkeleton /></AppLayout>;

  if (jobsError) {
    return (
      <AppLayout title="Kontrolna tabla">
        <PageTransition>
          <Breadcrumbs items={[{ label: "Kontrolna tabla" }]} />
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>Nije moguće učitati poslove</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 mt-2">
              <span>{jobsError instanceof Error ? jobsError.message : "Nepoznata greška"}</span>
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => refetchJobs()}>
                Pokušaj ponovo
              </Button>
            </AlertDescription>
          </Alert>
        </PageTransition>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Kontrolna tabla">
      <PageTransition>
        <Breadcrumbs items={[{ label: "Kontrolna tabla" }]} />

        {isFieldExecutionRole(currentRole) ? (
          <FieldTeamDashboard />
        ) : (
          <>
            <PageHeader
              title="Kontrolna tabla"
              description="Pregled poslovanja"
              icon={LayoutDashboard}
              actions={
                hasAccess("finances") ? (
                  <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                    <Download className="w-4 h-4 mr-1.5" />
                    Izvezi izveštaj
                  </Button>
                ) : undefined
              }
            />
            <ExportModal open={exportOpen} onOpenChange={setExportOpen} />

            {hasAccess("finances") && financesQuery.isError && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>Finansijski pregled nije učitan</AlertTitle>
                <AlertDescription className="flex flex-col gap-2 mt-2">
                  <span>
                    {financesQuery.error instanceof Error ? financesQuery.error.message : "Nepoznata greška"}
                  </span>
                  <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => financesQuery.refetch()}>
                    Pokušaj ponovo
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {(overdueJobs.length > 0 || lateDeliveriesCount > 0 || complaintAttentionCount > 0) && (
              <div className="flex flex-wrap gap-4 mb-4 p-3 bg-warning/5 border border-warning/20 rounded-lg">
                {overdueJobs.length > 0 && <AttentionIndicator count={overdueJobs.length} label="dospelih plaćanja" />}
                {lateDeliveriesCount > 0 && <AttentionIndicator count={lateDeliveriesCount} label="kašnjenja isporuke" />}
                {complaintAttentionCount > 0 && (
                  <AttentionIndicator count={complaintAttentionCount} label="otvorenih reklamacija" />
                )}
              </div>
            )}

        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {hasAccess("jobs") && (
            <StaggerItem>
              <div className="cursor-pointer" onClick={() => navigate("/jobs")}>
                <StatCard title="Aktivni poslovi" value={stats.activeJobs} icon={Briefcase} />
              </div>
            </StaggerItem>
          )}
          {hasAccess("jobs") && (
            <StaggerItem>
              <div className="cursor-pointer" onClick={() => navigate("/jobs?status=in_production")}>
                <StatCard title="Merenje / proizvodnja / ugradnja" value={stats.inProgress} icon={TrendingUp} />
              </div>
            </StaggerItem>
          )}
          {hasAccess("finances") && (
            <StaggerItem>
              <div className="cursor-pointer" onClick={() => navigate("/finances")}>
                <StatCard title="Neplaćeni poslovi" value={stats.unpaidJobs} icon={DollarSign} />
              </div>
            </StaggerItem>
          )}
          {hasAccess("material-orders") && (
            <StaggerItem>
              <div className="cursor-pointer" onClick={() => navigate("/material-orders")}>
                <StatCard title="Narudžbine na čekanju" value={stats.pendingOrders} icon={Package} />
              </div>
            </StaggerItem>
          )}
        </StaggerContainer>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {hasAccess("work-orders") && (
            <div className="cursor-pointer" onClick={() => navigate("/work-orders")}>
              <StatCard title="Predstojeće ugradnje" value={stats.upcomingInstallations} icon={Calendar} />
            </div>
          )}
          {hasAccess("jobs") && (
            <div className="cursor-pointer" onClick={() => navigate("/jobs?status=complaint")}>
              <StatCard title="Reklamacije / Servis" value={stats.complaints} icon={AlertTriangle} />
            </div>
          )}
          {hasAccess("finances") && (
            <>
              <StatCard title="Ukupan prihod" value={formatCurrency(stats.totalRevenue)} icon={DollarSign} />
              <StatCard title="Ukupno neplaćeno" value={formatCurrency(stats.totalUnpaid)} icon={DollarSign} />
            </>
          )}
        </div>
        {hasAccess("finances") && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-4">Naplata po mesecima</h2>
              <div className="h-64">
                {financesData?.monthlyCollectionData && financesData.monthlyCollectionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={financesData.monthlyCollectionData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(value: number) => [formatCurrencyBySettings(value), "Naplaćeno"]}
                      />
                      <Bar dataKey="naplaćeno" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
                    Nema podataka o uplatama
                  </div>
                )}
              </div>
            </div>
            <div className="bg-card rounded-xl border border-border p-5">
              <h2 className="font-semibold text-foreground mb-4">Distribucija statusa poslova</h2>
              <div className="h-64">
                {jobs.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={getStatusDistribution()}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                      >
                        {getStatusDistribution().map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(value: number, name: string) => [value, name]}
                      />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: "11px" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
                    Nema podataka o poslovima
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {hasAccess("jobs") && (
            <div className="lg:col-span-2 bg-card rounded-xl border border-border">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Poslednji poslovi</h2>
                <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}>Prikaži sve</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Posao #</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Kupac</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-5 py-3">Status</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3">Dugovanje</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.length > 0 ? (
                      jobs.slice(0, 5).map((job) => (
                        <tr
                          key={job.id}
                          className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                          onClick={() => navigate(`/jobs/${job.id}`)}
                        >
                          <td className="px-5 py-3 text-sm font-medium text-foreground">{job.jobNumber}</td>
                          <td className="px-5 py-3 text-sm text-muted-foreground">{job.customer.fullName}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <StatusBadge status={job.status} />
                              <OverduePaymentBadge job={job} />
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-right font-medium text-foreground">{formatCurrency(job.unpaidBalance)}</td>
                          <td className="px-5 py-3 text-right">
                            {job.scheduledDate && (
                              <span className="text-[10px] text-muted-foreground">
                                <Calendar className="w-3 h-3 inline mr-1" />{job.scheduledDate}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground italic">
                          Nema pronađenih poslova
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-6">
            <div className="bg-card rounded-xl border border-border">
              <div className="p-5 border-b border-border flex items-center justify-between">
                <h2 className="font-semibold text-foreground">Poslednje aktivnosti</h2>
                {hasAccess("activities") && (
                  <Button variant="ghost" size="sm" onClick={() => navigate("/activities")}>Sve</Button>
                )}
              </div>
              <div className="p-4 space-y-4 max-h-80 overflow-y-auto">
                {dashboardStats?.lastActivities && dashboardStats.lastActivities.length > 0 ? (
                  dashboardStats.lastActivities.map((act) => {
                    return (
                      <div key={act.id} className="flex gap-3 cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-lg transition-colors"
                        onClick={() => act.jobId && navigate(`/jobs/${act.jobId}`)}
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          {act.jobNumber && <p className="text-[10px] font-medium text-primary">{act.jobNumber}</p>}
                          <p className="text-sm text-foreground line-clamp-2">{act.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {act.createdBy} · {formatDateByAppLanguage(act.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-4 text-muted-foreground text-sm italic">
                    Nema nedavnih aktivnosti
                  </div>
                )}
              </div>
            </div>

            {hasAccess("material-orders") && lateDeliveriesCount > 0 && (
              <div className="bg-card rounded-xl border border-warning/30">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <Truck className="w-4 h-4 text-warning" />
                  <h3 className="text-sm font-semibold text-foreground">Kašnjenja isporuka</h3>
                </div>
                <div className="p-4 space-y-2">
                  {dashboardStats?.lateDeliveries.map(m => {
                    return (
                      <div key={m.id} className="flex items-center justify-between text-sm cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-lg"
                        onClick={() => m.jobId && navigate(`/jobs/${m.jobId}`)}>
                        <div>
                          <p className="font-medium text-foreground">{labelMaterialType(m.materialType)}</p>
                          <p className="text-xs text-muted-foreground">{m.supplier} {m.jobNumber ? `· ${m.jobNumber}` : ""}</p>
                        </div>
                        <span className="text-xs text-warning font-medium">Očekivano: {m.expectedDelivery}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}
