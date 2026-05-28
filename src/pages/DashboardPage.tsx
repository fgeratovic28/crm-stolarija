import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Briefcase,
  AlertTriangle,
  Package,
  Calendar,
  MessageSquare,
  DollarSign,
  TrendingUp,
  Truck,
  Download,
  Clock,
  Bell,
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
import { jobEligibleForInstallationScheduleBanner } from "@/lib/job-additional-works-display";
import { Button } from "@/components/ui/button";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";
import { ExportModal } from "@/components/modals/ExportModal";
import { ProcurementDiscrepancyModal } from "@/components/modals/ProcurementDiscrepancyModal";
import { ProcurementAdHocReportModal } from "@/components/modals/ProcurementAdHocReportModal";
import { useActiveProcurementComplaints } from "@/hooks/use-procurement-complaints";
import { useActivePendingProcurementAdHocItems } from "@/hooks/use-procurement-ad-hoc-items";
import { useUrgentSiteMissingNotifications } from "@/hooks/use-urgent-site-missing-notifications";
import { useSecureInvoiceMissingPart } from "@/hooks/use-secure-invoice-missing-part";
import { useInvoiceMissingSendToProcurement } from "@/hooks/use-invoice-missing-send-to-procurement";
import { useInvoiceMissingConfirmProductionSchedule } from "@/hooks/use-invoice-missing-confirm-production-schedule";
import { InvoiceMissingShortageOrderModal } from "@/components/modals/InvoiceMissingShortageOrderModal";
import { PROCUREMENT_COMPLAINT_STATUS } from "@/lib/procurement-complaint-status";
import { FieldTeamDashboard } from "@/components/dashboard/FieldTeamDashboard";
import { SalesAlertsWidget } from "@/components/dashboard/SalesAlertsWidget";
import { UnscheduledWorkOrdersBanner } from "@/components/dashboard/UnscheduledWorkOrdersBanner";
import { DashboardWarningsModal } from "@/components/dashboard/DashboardWarningsModal";
import { DashboardUrgentPredracunAlert } from "@/components/dashboard/DashboardUrgentPredracunAlert";
import { DashboardSlaStaleJobsAlert } from "@/components/dashboard/DashboardSlaStaleJobsAlert";
import { listStaleJobsForSla } from "@/lib/job-sla-stale";
import { supabase } from "@/lib/supabase";
import {
  useUnscheduledWorkOrdersDashboard,
  useAcceptedMeasurementDashboardBanner,
  useNeedsInstallationScheduleDashboard,
} from "@/hooks/use-unscheduled-work-orders-dashboard";
import { useSalesDashboardAlerts } from "@/hooks/use-sales-dashboard-alerts";
import { isFieldExecutionRole, isMontazaRole, isTerenRole } from "@/lib/field-team-access";
import {
  formatCurrencyBySettings,
  formatDateByAppLanguage,
  formatMaterialOrderDateForDisplay,
  readAppSettingsCache,
} from "@/lib/app-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { labelMaterialType } from "@/lib/activity-labels";

const PROCUREMENT_SLA_STATUSES = new Set<JobStatus>([
  "ready_for_work",
  "waiting_material",
  "partial_in_production",
  "in_production",
]);

/** HSL za pie chart — usklađeno sa `JOB_STATUS_CONFIG` bedževima (svaki status posebna nijansa). */
const STATUS_COLORS: Record<string, string> = {
  new: "hsl(215, 16%, 42%)",
  quote_sent: "hsl(199, 89%, 45%)",
  final_quote_sent: "hsl(217, 91%, 48%)",
  final_quote_accepted_pending_payment: "hsl(158, 72%, 32%)",
  accepted: "hsl(160, 84%, 36%)",
  measuring: "hsl(84, 81%, 40%)",
  measurement_processing: "hsl(262, 83%, 52%)",
  ready_for_work: "hsl(173, 58%, 36%)",
  waiting_material: "hsl(43, 96%, 45%)",
  partial_in_production: "hsl(24, 92%, 46%)",
  in_production: "hsl(347, 77%, 48%)",
  scheduled: "hsl(239, 84%, 54%)",
  installation_in_progress: "hsl(188, 94%, 38%)",
  installation_done_unpaid: "hsl(32, 92%, 42%)",
  completed: "hsl(142, 76%, 32%)",
  installation_problem: "hsl(25, 95%, 48%)",
  complaint: "hsl(0, 72%, 48%)",
  service: "hsl(271, 81%, 52%)",
  canceled: "hsl(240, 5%, 42%)",
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasAccess, currentRole } = useRole();
  const isProcurementRole = currentRole === "procurement";
  const isOfficeRole = currentRole === "office";
  const [exportOpen, setExportOpen] = useState(false);
  // null = zatvoren; "reported_issue" / "awaiting_delivery" / "all" — filter za modal pri otvaranju.
  const [procurementComplaintsFilter, setProcurementComplaintsFilter] = useState<
    "reported_issue" | "awaiting_delivery" | null
  >(null);
  const { jobs = [], isLoading: loadingJobs, error: jobsError, refetch: refetchJobs } = useJobs();
  const financesQuery = useFinancesData();
  const statsQuery = useDashboardStats();
  const financesData = financesQuery.data;
  const dashboardStats = statsQuery.data;

  const loading = loadingJobs || financesQuery.isLoading || statsQuery.isLoading;

  const showProcurementComplaintsBlock =
    hasAccess("material-orders") && !isFieldExecutionRole(currentRole);
  const activeComplaintsQuery = useActiveProcurementComplaints(showProcurementComplaintsBlock);
  const activeProcurementComplaints = activeComplaintsQuery.data ?? [];
  const reportedIssueComplaints = activeProcurementComplaints.filter(
    (c) => c.status === PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE,
  );
  const awaitingDeliveryComplaints = activeProcurementComplaints.filter(
    (c) => c.status === PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY,
  );

  const adHocPendingQuery = useActivePendingProcurementAdHocItems(showProcurementComplaintsBlock);
  const pendingAdHocItems = adHocPendingQuery.data ?? [];
  const [adHocReportOpen, setAdHocReportOpen] = useState(false);

  const showSalesAlertsWidget =
    (currentRole === "office" || currentRole === "admin") && !isFieldExecutionRole(currentRole);
  /** SLA zastoj u statusu: office/admin/procurement (sa podelom statusa po ulozi). */
  const showSlaStaleDashboard =
    (currentRole === "office" || currentRole === "admin" || currentRole === "procurement") &&
    !isFieldExecutionRole(currentRole);
  /** RN bez tima (RPC) — uloge sa modulom Poslovi, bez teren/montaža/proizvodnje. */
  const showUnscheduledWorkOrdersBanner =
    hasAccess("jobs") && !isFieldExecutionRole(currentRole) && currentRole !== "procurement";
  const unscheduledWoQuery = useUnscheduledWorkOrdersDashboard(showUnscheduledWorkOrdersBanner, currentRole);
  const acceptedMeasurementFromJobs = useAcceptedMeasurementDashboardBanner(jobs, showUnscheduledWorkOrdersBanner);
  const needsInstallationFromJobs = useNeedsInstallationScheduleDashboard(jobs, showUnscheduledWorkOrdersBanner);
  const hasAcceptedOrMeasuringJob = jobs.some((j) => j.status === "accepted" || j.status === "measuring");
  const hasInstallScheduleCandidates = jobs.some(jobEligibleForInstallationScheduleBanner);
  const mergedAcceptedNeedsMeasurement =
    acceptedMeasurementFromJobs.data ?? unscheduledWoQuery.data?.acceptedNeedsMeasurement ?? [];
  /** Ugradnja u statusu „Čeka ugradnju“ ide u posebnu listu (termin + tim); ostali — samo „bez tima“. */
  const scheduledJobIds = useMemo(
    () => new Set(jobs.filter((j) => j.status === "scheduled").map((j) => j.id)),
    [jobs],
  );
  const mergedNeedsInstallationSchedule = needsInstallationFromJobs.data ?? [];

  const showUrgentSiteMissingBanner = currentRole === "procurement" || currentRole === "admin";

  const urgentSiteMissingQuery = useUrgentSiteMissingNotifications(showUrgentSiteMissingBanner);
  const secureInvoiceMissing = useSecureInvoiceMissingPart();
  const sendInvoiceMissingToProcurement = useInvoiceMissingSendToProcurement();
  const confirmInvoiceMissingProduction = useInvoiceMissingConfirmProductionSchedule();
  const [urgentProcurementDialog, setUrgentProcurementDialog] = useState<{ jobId: string; position: string } | null>(
    null,
  );
  const [adminWarningsModalOpen, setAdminWarningsModalOpen] = useState(false);
  const [extraWarningsModalOpen, setExtraWarningsModalOpen] = useState(false);
  const canSecureInvoiceMissingPart =
    (currentRole === "admin" || currentRole === "procurement") && !isFieldExecutionRole(currentRole);
  const canConfirmInvoiceMissingProduction =
    currentRole === "admin" || currentRole === "production" || currentRole === "procurement";

  const appSettings = readAppSettingsCache();
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);

  const pipelineStatuses: JobStatus[] = [
    "accepted",
    "measuring",
    "measurement_processing",
    "final_quote_sent",
    "final_quote_accepted_pending_payment",
    "ready_for_work",
    "waiting_material",
    "partial_in_production",
    "in_production",
    "installation_in_progress",
    "installation_done_unpaid",
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

  const salesDashboardAlertsQuery = useSalesDashboardAlerts(showSalesAlertsWidget);
  const salesData = salesDashboardAlertsQuery.data;
  const salesAlertCount =
    salesData != null ? salesData.followups.length + salesData.addonSiteQuotes.length : 0;
  const hasSalesWarnings = showSalesAlertsWidget && salesAlertCount > 0;

  const slaStaleRows = useMemo(() => {
    if (!showSlaStaleDashboard || !appSettings.notifStaleJobStatus) return [];
    const rows = listStaleJobsForSla(jobs, appSettings.jobStaleStatusDays);
    if (currentRole === "office") {
      return rows.filter((row) => !PROCUREMENT_SLA_STATUSES.has(row.status));
    }
    if (currentRole === "procurement") {
      return rows.filter((row) => PROCUREMENT_SLA_STATUSES.has(row.status));
    }
    return rows;
  }, [showSlaStaleDashboard, jobs, appSettings.notifStaleJobStatus, appSettings.jobStaleStatusDays, currentRole]);

  const hasSlaStaleWarnings = showSlaStaleDashboard && slaStaleRows.length > 0;

  useEffect(() => {
    if (!showSlaStaleDashboard || !appSettings.notifStaleJobStatus) return;
    void supabase.rpc("run_job_sla_stale_reminders").then(({ error }) => {
      if (error) console.warn("run_job_sla_stale_reminders:", error.message);
    });
  }, [showSlaStaleDashboard, appSettings.notifStaleJobStatus, jobs.length]);

  const unscheduledLoadingBlock =
    showUnscheduledWorkOrdersBanner &&
    (unscheduledWoQuery.isLoading ||
      (hasAcceptedOrMeasuringJob &&
        acceptedMeasurementFromJobs.isLoading &&
        acceptedMeasurementFromJobs.data === undefined) ||
      (hasInstallScheduleCandidates &&
        needsInstallationFromJobs.isLoading &&
        needsInstallationFromJobs.data === undefined));

  const unscheduledErrorBlock =
    showUnscheduledWorkOrdersBanner &&
    unscheduledWoQuery.isError &&
    !mergedAcceptedNeedsMeasurement.length &&
    !mergedNeedsInstallationSchedule.length &&
    !(unscheduledWoQuery.data?.measurement?.length) &&
    !(unscheduledWoQuery.data?.installation?.length) &&
    !(unscheduledWoQuery.data?.production?.length) &&
    !(unscheduledWoQuery.data?.complaint?.length) &&
    !(unscheduledWoQuery.data?.service?.length);

  const unscheduledDataReadyForBanner =
    showUnscheduledWorkOrdersBanner &&
    !unscheduledLoadingBlock &&
    !unscheduledErrorBlock &&
    (unscheduledWoQuery.data != null ||
      mergedAcceptedNeedsMeasurement.length > 0 ||
      mergedNeedsInstallationSchedule.length > 0);

  const measRows = unscheduledWoQuery.data?.measurement ?? [];
  const instRowsAll = unscheduledWoQuery.data?.installation ?? [];
  const instRows = instRowsAll.filter((r) => !scheduledJobIds.has(r.jobId));
  const prodRows = unscheduledWoQuery.data?.production ?? [];
  const compRows = unscheduledWoQuery.data?.complaint ?? [];
  const servRows = unscheduledWoQuery.data?.service ?? [];

  const unscheduledTotalRows =
    measRows.length +
    instRows.length +
    prodRows.length +
    compRows.length +
    servRows.length +
    mergedAcceptedNeedsMeasurement.length +
    mergedNeedsInstallationSchedule.length;

  const hasUnscheduledWarnings = unscheduledDataReadyForBanner && unscheduledTotalRows > 0;

  const urgentRows = urgentSiteMissingQuery.data ?? [];
  const hasUrgentPredracun = showUrgentSiteMissingBanner && urgentRows.length > 0;

  const hasProcReported =
    showProcurementComplaintsBlock && reportedIssueComplaints.length > 0;
  const hasProcAwaiting =
    showProcurementComplaintsBlock && awaitingDeliveryComplaints.length > 0;
  const hasProcAdHoc = showProcurementComplaintsBlock && pendingAdHocItems.length > 0;

  const hasAttentionStrip =
    !isProcurementRole &&
    (overdueJobs.length > 0 || lateDeliveriesCount > 0 || complaintAttentionCount > 0);

  const isAdminDashboard = currentRole === "admin";
  const actionPendingUrgent =
    secureInvoiceMissing.isPending ||
    sendInvoiceMissingToProcurement.isPending ||
    confirmInvoiceMissingProduction.isPending;

  const warningSections: { id: string; title: string; description?: string; content: ReactNode }[] = [];
  if (hasSalesWarnings) {
    warningSections.push({
      id: "sales",
      title: "Prodaja i prateći nalozi",
      description: "Upiti sa terena za dopunu i prateći nalozi bez montaže.",
      content: <SalesAlertsWidget />,
    });
  }
  if (hasSlaStaleWarnings) {
    warningSections.push({
      id: "sla-stale",
      title: "SLA — zastoj u statusu",
      description: `Poslovi u istom statusu duže od ${appSettings.jobStaleStatusDays} dana (prag iz podešavanja).`,
      content: (
        <DashboardSlaStaleJobsAlert
          rows={slaStaleRows}
          thresholdDays={appSettings.jobStaleStatusDays}
          withBottomMargin={false}
        />
      ),
    });
  }
  if (hasUnscheduledWarnings) {
    warningSections.push({
      id: "unscheduled",
      title: "Neraspoređeni radni nalozi",
      description: "RN bez tima, merenje na prihvaćenom poslu, ili ugradnja u statusu Čeka ugradnju bez termina.",
      content: (
        <UnscheduledWorkOrdersBanner
          measurement={measRows}
          installation={instRows}
          production={prodRows}
          complaint={compRows}
          service={servRows}
          acceptedNeedsMeasurement={mergedAcceptedNeedsMeasurement}
          needsInstallationSchedule={mergedNeedsInstallationSchedule}
        />
      ),
    });
  }
  if (hasProcReported) {
    warningSections.push({
      id: "proc-reported",
      title: "Isporuke — nedostatak / oštećenje",
      content: (
        <Alert variant="destructive" className="mb-0 border-destructive/70 bg-destructive/10">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Isporuke sa nedostatkom / oštećenjem</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {reportedIssueComplaints.length}{" "}
              {reportedIssueComplaints.length === 1 ? "stavka je prijavljena" : "stavke su prijavljene"} kao
              nedostatak ili oštećenje materijala — pošaljite PDF nabavci i pokrenite rešavanje.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-fit shrink-0"
              onClick={() => setProcurementComplaintsFilter("reported_issue")}
            >
              Pogledaj izveštaj o neslaganjima
            </Button>
          </AlertDescription>
        </Alert>
      ),
    });
  }
  if (hasProcAwaiting) {
    warningSections.push({
      id: "proc-awaiting",
      title: "Reklamacije nabavke — u rešavanju",
      content: (
        <Alert
          variant="default"
          className="mb-0 border-destructive/45 bg-destructive/5 text-foreground dark:border-destructive/35 dark:bg-destructive/10"
        >
          <Clock className="h-4 w-4 text-destructive dark:text-destructive" />
          <AlertTitle className="text-foreground">
            Reklamacije — u rešavanju / čeka se dostava
          </AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 text-foreground/90 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {awaitingDeliveryComplaints.length}{" "}
              {awaitingDeliveryComplaints.length === 1 ? "stavka je u rešavanju" : "stavke su u rešavanju"} —
              magacin ih prima skeniranjem barkoda iz PDF-a kada stigne dostava.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-fit shrink-0 border-destructive/25 bg-background/80 hover:bg-background"
              onClick={() => setProcurementComplaintsFilter("awaiting_delivery")}
            >
              Pogledaj izveštaj o neslaganjima
            </Button>
          </AlertDescription>
        </Alert>
      ),
    });
  }
  if (hasProcAdHoc) {
    warningSections.push({
      id: "proc-adhoc",
      title: "Vanredne stavke nabavke",
      content: (
        <Alert variant="destructive" className="mb-0 border-destructive/70 bg-destructive/10">
          <Package className="h-4 w-4" />
          <AlertTitle>Vanredne stavke čekaju prijem</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {pendingAdHocItems.length}{" "}
              {pendingAdHocItems.length === 1 ? "vanredna stavka čeka" : "vanrednih stavki čekaju"} prijem —
              otvorite PDF i pošaljite dobavljaču radi dostave, pa magacin skenira A-barkod.
            </span>
            <Button type="button" variant="secondary" size="sm" className="w-fit shrink-0" onClick={() => setAdHocReportOpen(true)}>
              Pogledaj izveštaj vanrednih stavki
            </Button>
          </AlertDescription>
        </Alert>
      ),
    });
  }
  if (hasAttentionStrip) {
    warningSections.push({
      id: "attention",
      title: "Finansije i isporuke — pažnja",
      description: "Dospeli računi, kašnjenja isporuke ili otvorene reklamacije (broj poslova).",
      content: (
        <div className="flex flex-wrap gap-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
          {overdueJobs.length > 0 ? (
            <AttentionIndicator count={overdueJobs.length} label="dospelih plaćanja" />
          ) : null}
          {lateDeliveriesCount > 0 ? (
            <AttentionIndicator count={lateDeliveriesCount} label="kašnjenja isporuke" />
          ) : null}
          {complaintAttentionCount > 0 ? (
            <AttentionIndicator count={complaintAttentionCount} label="otvorenih reklamacija" />
          ) : null}
        </div>
      ),
    });
  }

  /** Hitno predračun: uvek samostalan blok ispod (nema duplog u `warningSections` za nabavku/proizvodnju/kancelariju). */
  const urgentWarningSection = hasUrgentPredracun
    ? {
        id: "urgent-predracun",
        title: "Hitno (predračun na terenu)",
        description: "Stavka sa predračuna nedostaje na ugradnji — naručiti / proizvesti odmah.",
        content: (
          <DashboardUrgentPredracunAlert
            rows={urgentRows}
            hasAccess={hasAccess}
            canSecureInvoiceMissingPart={canSecureInvoiceMissingPart}
            canConfirmInvoiceMissingProduction={canConfirmInvoiceMissingProduction}
            actionPending={actionPendingUrgent}
            onSecurePart={async (a) => {
              await secureInvoiceMissing.mutateAsync(a);
            }}
            onConfirmProduction={async (a) => {
              await confirmInvoiceMissingProduction.mutateAsync(a);
            }}
            onOpenProslediNabavku={(a) => setUrgentProcurementDialog({ jobId: a.jobId, position: a.position })}
            withBottomMargin={false}
          />
        ),
      }
    : null;

  const adminModalSections = [
    ...(urgentWarningSection ? [urgentWarningSection] : []),
    ...warningSections,
  ];

  const adminUsesWarningsHub = isAdminDashboard && adminModalSections.length > 0;
  const unscheduledInWarningSections = warningSections.some((s) => s.id === "unscheduled");
  /** Sivi baner samo kad nije već u modalu / inline listi upozorenja (izbegni duplikat). */
  const showUnscheduledBannerOnPage =
    showUnscheduledWorkOrdersBanner && !adminUsesWarningsHub && !unscheduledInWarningSections;
  /** Admin: sve u modalu. Ostale uloge: prva dva tipa na tabli + „Prikaži još“. */
  const warningSectionsOverflow = warningSections.length > 2;
  const inlineWarningSections = adminUsesWarningsHub
    ? []
    : warningSectionsOverflow
      ? warningSections.slice(0, 2)
      : warningSections;
  const extraWarningSections = adminUsesWarningsHub
    ? []
    : warningSectionsOverflow
      ? warningSections.slice(2)
      : [];
  const showSalesLoadingStandalone =
    showSalesAlertsWidget &&
    salesDashboardAlertsQuery.isLoading &&
    !warningSections.some((s) => s.id === "sales");

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

        {hasUrgentPredracun && !adminUsesWarningsHub ? (
          <div className="mb-4">
            <DashboardUrgentPredracunAlert
              rows={urgentRows}
              hasAccess={hasAccess}
              canSecureInvoiceMissingPart={canSecureInvoiceMissingPart}
              canConfirmInvoiceMissingProduction={canConfirmInvoiceMissingProduction}
              actionPending={actionPendingUrgent}
              onSecurePart={async (a) => {
                await secureInvoiceMissing.mutateAsync(a);
              }}
              onConfirmProduction={async (a) => {
                await confirmInvoiceMissingProduction.mutateAsync(a);
              }}
              onOpenProslediNabavku={(a) => setUrgentProcurementDialog({ jobId: a.jobId, position: a.position })}
            />
          </div>
        ) : null}

        {isFieldExecutionRole(currentRole) ? (
          <FieldTeamDashboard />
        ) : (
          <>
            <PageHeader
              title="Kontrolna tabla"
              description="Pregled poslovanja"
              icon={LayoutDashboard}
              actions={
                hasAccess("finances") && !isProcurementRole && currentRole !== "office" ? (
                  <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
                    <Download className="w-4 h-4 mr-1.5" />
                    Izvezi izveštaj
                  </Button>
                ) : undefined
              }
            />
            <ExportModal open={exportOpen} onOpenChange={setExportOpen} />

            {showSalesLoadingStandalone && !adminUsesWarningsHub && !warningSections.some((s) => s.id === "sales") ? (
              <SalesAlertsWidget />
            ) : null}

            {adminUsesWarningsHub ? (
              <Alert className="mb-4 border-destructive/25 bg-destructive/[0.04] dark:border-destructive/20 dark:bg-destructive/[0.06]">
                <Bell className="h-4 w-4 text-destructive" />
                <AlertTitle className="flex flex-col gap-2 text-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>Kontrola upozorenja ({adminModalSections.length})</span>
                  <Button
                    type="button"
                    size="sm"
                    className="w-fit shrink-0"
                    onClick={() => setAdminWarningsModalOpen(true)}
                  >
                    Otvori sve u modalu
                  </Button>
                </AlertTitle>
                <AlertDescription className="text-sm text-muted-foreground">
                  Sva upozorenja su u modalu. Otvorite modal da vidite sva upozorenja.
                </AlertDescription>
              </Alert>
            ) : null}

            {showUnscheduledBannerOnPage ? (
              (unscheduledWoQuery.isLoading ||
                (hasAcceptedOrMeasuringJob &&
                  acceptedMeasurementFromJobs.isLoading &&
                  acceptedMeasurementFromJobs.data === undefined) ||
                (hasInstallScheduleCandidates &&
                  needsInstallationFromJobs.isLoading &&
                  needsInstallationFromJobs.data === undefined)) ? (
                <Alert className="mb-4 border-border/70 bg-muted/40 text-muted-foreground">
                  <AlertTitle className="text-sm text-foreground/85">Provera naloga bez tima…</AlertTitle>
                  <AlertDescription className="text-xs">Učitavanje liste za kontrolnu tablu.</AlertDescription>
                </Alert>
              ) : unscheduledWoQuery.isError &&
                !mergedAcceptedNeedsMeasurement.length &&
                !mergedNeedsInstallationSchedule.length &&
                !(unscheduledWoQuery.data?.measurement?.length) &&
                !(unscheduledWoQuery.data?.installation?.length) &&
                !(unscheduledWoQuery.data?.production?.length) &&
                !(unscheduledWoQuery.data?.complaint?.length) &&
                !(unscheduledWoQuery.data?.service?.length) ? (
                <Alert variant="destructive" className="mb-4 border-destructive/40 bg-destructive/5">
                  <AlertTitle>Lista naloga bez tima nije učitana</AlertTitle>
                  <AlertDescription className="mt-1 space-y-2 text-sm">
                    <span>
                      {unscheduledWoQuery.error instanceof Error
                        ? unscheduledWoQuery.error.message
                        : "Nepoznata greška"}
                    </span>
                    <span className="block text-muted-foreground">
                      Za uloge nabavka / finansije potrebna je migracija koja dodaje RPC{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                        get_dashboard_unscheduled_work_orders_json
                      </code>{" "}
                      (<code className="rounded bg-muted px-1 py-0.5 text-foreground">20260529180000</code>) i
                      stariji RPC-ovi{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                        list_work_orders_missing_team_for_dashboard
                      </code>{" "}
                      (fajl <code className="rounded bg-muted px-1 py-0.5 text-foreground">20260527120000</code> i{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-foreground">20260527140000</code>
                      ) i opciono{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                        list_accepted_needs_measurement_schedule_for_dashboard
                      </code>{" "}
                      (<code className="rounded bg-muted px-1 py-0.5 text-foreground">20260529103000</code> /{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-foreground">20260529150000</code>). Kancelarija
                      i admin mogu da vide listu i bez RPC-a ako imaju pristup tabeli radnih naloga.
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => {
                        void unscheduledWoQuery.refetch();
                        void acceptedMeasurementFromJobs.refetch();
                      }}
                    >
                      Pokušaj ponovo
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : unscheduledWoQuery.data != null ||
                mergedAcceptedNeedsMeasurement.length > 0 ||
                mergedNeedsInstallationSchedule.length > 0 ? (
                <UnscheduledWorkOrdersBanner
                  measurement={unscheduledWoQuery.data?.measurement ?? []}
                  installation={unscheduledWoQuery.data?.installation ?? []}
                  production={unscheduledWoQuery.data?.production ?? []}
                  complaint={unscheduledWoQuery.data?.complaint ?? []}
                  service={unscheduledWoQuery.data?.service ?? []}
                  acceptedNeedsMeasurement={mergedAcceptedNeedsMeasurement}
                  needsInstallationSchedule={mergedNeedsInstallationSchedule}
                />
              ) : null
            ) : null}

            {inlineWarningSections.length > 0 || extraWarningSections.length > 0 ? (
              <div className="mb-4 space-y-4">
                {inlineWarningSections.map((s) => (
                  <div key={s.id}>{s.content}</div>
                ))}
                {extraWarningSections.length > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setExtraWarningsModalOpen(true)}>
                    Prikaži još {extraWarningSections.length}{" "}
                    {extraWarningSections.length === 1 ? "upozorenje" : "upozorenja"}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {adminModalSections.length > 0 ? (
              <DashboardWarningsModal
                open={adminWarningsModalOpen}
                onOpenChange={setAdminWarningsModalOpen}
                heading="Sva aktivna upozorenja"
                sections={adminModalSections}
              />
            ) : null}
            {extraWarningSections.length > 0 ? (
              <DashboardWarningsModal
                open={extraWarningsModalOpen}
                onOpenChange={setExtraWarningsModalOpen}
                heading={`Još ${extraWarningSections.length} upozorenja`}
                sections={extraWarningSections}
              />
            ) : null}

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

            <ProcurementDiscrepancyModal
              open={procurementComplaintsFilter !== null}
              onOpenChange={(v) => {
                if (!v) setProcurementComplaintsFilter(null);
              }}
              complaints={
                procurementComplaintsFilter === "reported_issue"
                  ? reportedIssueComplaints
                  : procurementComplaintsFilter === "awaiting_delivery"
                    ? awaitingDeliveryComplaints
                    : []
              }
            />

            <ProcurementAdHocReportModal
              open={adHocReportOpen}
              onOpenChange={setAdHocReportOpen}
              items={pendingAdHocItems}
            />

        {isProcurementRole ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { status: "ready_for_work", label: "Spremno za rad" },
              { status: "waiting_material", label: "Čeka materijal" },
              { status: "partial_in_production", label: "Delimično u proizvodnji" },
              { status: "in_production", label: "U proizvodnji" },
            ].map((kpi) => {
              const count = jobs.filter((j) => j.status === kpi.status).length;
              return (
                <StatCard
                  key={kpi.status}
                  title={kpi.label}
                  value={String(count)}
                  icon={Briefcase}
                  onClick={() => navigate(`/jobs?status=${kpi.status}`)}
                />
              );
            })}
          </div>
        ) : isOfficeRole ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { status: "new", label: "Upiti (ponuda)", openTab: "quotes", icon: MessageSquare },
              { status: "measurement_processing", label: "Obrada mera (finalna ponuda)", openTab: "quotes", icon: MessageSquare },
              { status: "final_quote_accepted_pending_payment", label: "Čeka uplatu", openTab: "finances", icon: DollarSign },
              { status: "installation_done_unpaid", label: "Ugradnja završena / dug", openTab: "finances", icon: DollarSign },
            ].map((kpi) => {
              const count = jobs.filter((j) => j.status === kpi.status).length;
              const Icon = kpi.icon;
              return (
                <StatCard
                  key={kpi.status}
                  title={kpi.label}
                  value={String(count)}
                  icon={Icon}
                  onClick={() => navigate(`/jobs?status=${kpi.status}&openTab=${kpi.openTab}`)}
                />
              );
            })}
          </div>
        ) : (
          <>
            <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {hasAccess("jobs") && (
                <StaggerItem>
                  <StatCard
                    title="Aktivni poslovi"
                    value={stats.activeJobs}
                    icon={Briefcase}
                    onClick={() => navigate("/jobs?preset=active")}
                  />
                </StaggerItem>
              )}
              {hasAccess("jobs") && (
                <StaggerItem>
                  <StatCard
                    title="Merenje / proizvodnja / ugradnja"
                    value={stats.inProgress}
                    icon={TrendingUp}
                    onClick={() => navigate("/jobs?preset=pipeline")}
                  />
                </StaggerItem>
              )}
              {hasAccess("finances") && (
                <StaggerItem>
                  <StatCard
                    title="Neplaćeni poslovi"
                    value={stats.unpaidJobs}
                    icon={DollarSign}
                    onClick={() => navigate("/finances?tab=payments&payment=unpaid")}
                  />
                </StaggerItem>
              )}
              {hasAccess("material-orders") && (
                <StaggerItem>
                  <StatCard
                    title="Narudžbine na čekanju"
                    value={stats.pendingOrders}
                    icon={Package}
                    onClick={() => navigate("/material-orders?delivery=pending")}
                  />
                </StaggerItem>
              )}
            </StaggerContainer>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {hasAccess("work-orders") && (
                <StatCard
                  title="Predstojeće ugradnje"
                  value={stats.upcomingInstallations}
                  icon={Calendar}
                  onClick={() => navigate("/work-orders?type=installation&status=pending")}
                />
              )}
              {hasAccess("jobs") && (
                <StatCard
                  title="Reklamacije / Servis"
                  value={stats.complaints}
                  icon={AlertTriangle}
                  onClick={() => navigate("/jobs?preset=complaints")}
                />
              )}
              {hasAccess("finances") && (
                <>
                  <StatCard
                    title="Ukupan prihod"
                    value={formatCurrency(stats.totalRevenue)}
                    icon={DollarSign}
                    onClick={() => navigate("/finances?tab=overview")}
                  />
                  <StatCard
                    title="Ukupno neplaćeno"
                    value={formatCurrency(stats.totalUnpaid)}
                    icon={DollarSign}
                    onClick={() => navigate("/finances?tab=payments&payment=unpaid")}
                  />
                </>
              )}
            </div>
          </>
        )}
        {hasAccess("finances") && !isProcurementRole && currentRole !== "office" && (
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
          {hasAccess("jobs") && !isProcurementRole && (
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
                        <span className="text-xs text-warning font-medium">
                          Očekivano: {formatMaterialOrderDateForDisplay(m.expectedDelivery) || "—"}
                        </span>
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

        <InvoiceMissingShortageOrderModal
          open={!!urgentProcurementDialog}
          onOpenChange={(open) => {
            if (!open) setUrgentProcurementDialog(null);
          }}
          jobId={urgentProcurementDialog?.jobId ?? ""}
          position={urgentProcurementDialog?.position ?? ""}
          sendMutation={sendInvoiceMissingToProcurement}
        />
      </PageTransition>
    </AppLayout>
  );
}
