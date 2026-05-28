import { useCallback, useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useSearchParams, useLocation, Link } from "react-router-dom";
import {
  ArrowLeft, MapPin, Phone, Mail, Building2, DollarSign, Package,
  ClipboardList, Calendar, AlertTriangle, User, Copy, Lock, Unlock, Trash2, Info,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useJobDetails, useJobs } from "@/hooks/use-jobs";
import { useJobRelatedData } from "@/hooks/use-job-data";
import { ActivitiesTab } from "@/components/job-tabs/ActivitiesTab";
import { FinancesTab } from "@/components/job-tabs/FinancesTab";
import { MaterialOrdersTab } from "@/components/job-tabs/MaterialOrdersTab";
import { WorkOrdersTab } from "@/components/job-tabs/WorkOrdersTab";
import { FieldReportsTab } from "@/components/job-tabs/FieldReportsTab";
import { FilesTab } from "@/components/job-tabs/FilesTab";
import { QuotesTab } from "@/components/job-tabs/QuotesTab";
import { AddressMiniMap } from "@/components/shared/AddressMiniMap";
import { AddActivityModal } from "@/components/modals/AddActivityModal";
import { NewJobModal } from "@/components/modals/NewJobModal";
import { JOB_STATUS_CONFIG, type JobStatus } from "@/types";
import {
  formatCurrencyBySettings,
  formatDateByAppLanguage,
  formatMaterialOrderDateForDisplay,
} from "@/lib/app-settings";
import { formatWorkOrderScheduleDisplay } from "@/lib/schedule-datetime-display";
import { labelMaterialType, labelWorkOrderType } from "@/lib/activity-labels";
import { getInstallationAddressForDisplay } from "@/lib/map-geocode";
import { getJobInstallationScheduleDisplay } from "@/lib/job-installation-schedule";
import { useWorkOrders } from "@/hooks/use-work-orders";
import {
  DASHBOARD_ACCEPTED_MEASUREMENT_FROM_JOBS_QUERY_KEY,
  DASHBOARD_NEEDS_INSTALLATION_SCHEDULE_FROM_JOBS_QUERY_KEY,
  DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY,
} from "@/hooks/use-unscheduled-work-orders-dashboard";
import { useFiles } from "@/hooks/use-files";
import { useTeams } from "@/hooks/use-teams";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { ProductionMaterialTab } from "@/components/job-tabs/ProductionMaterialTab";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { openWarrantyOrServiceFromCompletedJob } from "@/lib/job-workflow-actions";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { materialOrderDeliveryResolved } from "@/lib/material-order-delivery-resolved";
import { isProductionWorkOrderPhaseDeferred } from "@/lib/production-workflow-phase";
import {
  isAdditionalWorksChildJob,
  isChildJobStatusUnexpected,
  jobInstallationSchedulingComplete,
  jobStatusDisplayHint,
  jobStatusLabelForDisplay,
  jobStatusOptionsForSelect,
} from "@/lib/job-additional-works-display";
import { LocalFileInlinePreview } from "@/components/work-order/FileAttachmentInlinePreview";
import { WorkOrderScheduleDateTimePicker } from "@/components/work-order/WorkOrderScheduleDateTimePicker";
import {
  isoHasExplicitScheduleTime,
  normalizeWorkOrderDateYmd,
  workOrderScheduledDatetimeForDb,
} from "@/lib/work-order-schedule-calendar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { clearActivitiesListRestorePending } from "@/lib/activities-list-session";
import { readJobDetailsReturnState } from "@/lib/job-details-return";

export default function JobDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const listReturn = readJobDetailsReturnState(location.state);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (listReturn?.returnTo !== "/activities") {
      clearActivitiesListRestorePending();
    }
  }, [listReturn?.returnTo]);

  const { data: job, isLoading: isLoadingJob, error } = useJobDetails(id);
  const { 
    activities: jobActivities, 
    payments: jobPayments, 
    materialOrders: jobMaterials, 
    workOrders: jobWorkOrders, 
    fieldReports: jobFieldReports, 
    files: jobFiles, 
    quotes: jobQuotes,
    jobItems,
    isLoading: isLoadingRelated 
  } = useJobRelatedData(id);

  const parentJobSummaryQuery = useQuery({
    queryKey: ["job-parent-summary", job?.parentJobId],
    enabled: !!job?.parentJobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number")
        .eq("id", job!.parentJobId!)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; job_number: string } | null;
    },
  });

  const childJobsQuery = useQuery({
    queryKey: ["job-additional-works-children", job?.id],
    enabled: !!job?.id && !job?.parentJobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, status")
        .eq("parent_job_id", job!.id)
        .order("job_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; job_number: string; status: JobStatus }>;
    },
  });

  const { updateJobStatus, confirmJobProductionDone, toggleJobStatusLock, updateJobPricing } = useJobs();
  const { createWorkOrder, updateWorkOrder } = useWorkOrders(id);
  const { uploadFile } = useFiles();
  const { teams } = useTeams();
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "quotes") {
      setActiveTab("quotes");
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    } else if (tab === "finances") {
      setActiveTab("finances");
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    } else if (tab === "materials") {
      setActiveTab("materials");
      const next = new URLSearchParams(searchParams);
      next.delete("tab");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [measurementModalOpen, setMeasurementModalOpen] = useState(false);
  const [installationModalOpen, setInstallationModalOpen] = useState(false);
  const [measurementDateTime, setMeasurementDateTime] = useState("");
  const [measurementTeamId, setMeasurementTeamId] = useState("");
  /** Otvaranje detalja naloga sa kartice „Aktivni radni nalozi“ (pregled). */
  const [openDetailWorkOrderId, setOpenDetailWorkOrderId] = useState<string | null>(null);
  const [measurementNote, setMeasurementNote] = useState("");
  const [measurementChecklistDraft, setMeasurementChecklistDraft] = useState("");
  const [measurementChecklist, setMeasurementChecklist] = useState<string[]>([]);
  const [measurementAttachmentFile, setMeasurementAttachmentFile] = useState<File | null>(null);
  const [installationDateTime, setInstallationDateTime] = useState("");
  const [installationPriorDateYmd, setInstallationPriorDateYmd] = useState<string | null>(null);
  const [installationTeamId, setInstallationTeamId] = useState("");
  const [installationNote, setInstallationNote] = useState("");
  const [installationChecklistDraft, setInstallationChecklistDraft] = useState("");
  const [installationChecklist, setInstallationChecklist] = useState<string[]>([]);
  const [installationAttachmentFile, setInstallationAttachmentFile] = useState<File | null>(null);
  const [installationSchedulePending, setInstallationSchedulePending] = useState(false);
  const [warrantyModalOpen, setWarrantyModalOpen] = useState(false);
  const [warrantyKind, setWarrantyKind] = useState<"complaint" | "service">("complaint");
  const [warrantyNotes, setWarrantyNotes] = useState("");
  const [warrantyScheduledDate, setWarrantyScheduledDate] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  });
  const [warrantySubmitting, setWarrantySubmitting] = useState(false);
  const [warrantyAttachmentFile, setWarrantyAttachmentFile] = useState<File | null>(null);
  const [fullJobCancelOpen, setFullJobCancelOpen] = useState(false);
  const { user: authUser } = useAuthStore();
  const { hasAccess, canPerformAction, currentRole } = useRole();
  const showCustomerPhones = currentRole !== "procurement";
  const showFinancesTab = hasAccess("finances") && currentRole !== "procurement";
  const showQuotesTab = hasAccess("quotes");
  const canSeeActivitiesTab = hasAccess("activities");
  const canSeeImportMaterialTab = hasAccess("material-orders") || canPerformAction("view_production_details");
  const canSeeMaterialsTab = hasAccess("material-orders");
  const canSeeWorkOrdersTab = hasAccess("work-orders");
  const canSeeFieldReportsTab = hasAccess("field-reports");
  const canSeeFilesTab = hasAccess("files") && currentRole !== "procurement";

  useEffect(() => {
    const allowed = new Set<string>(["overview"]);
    if (canSeeActivitiesTab) allowed.add("activities");
    if (showFinancesTab) allowed.add("finances");
    if (showQuotesTab) allowed.add("quotes");
    if (canSeeImportMaterialTab) allowed.add("import-material");
    if (canSeeMaterialsTab) allowed.add("materials");
    if (canSeeWorkOrdersTab) allowed.add("work-orders");
    if (canSeeFieldReportsTab) allowed.add("field-reports");
    if (canSeeFilesTab) allowed.add("files");
    if (!allowed.has(activeTab)) setActiveTab("overview");
  }, [
    activeTab,
    canSeeActivitiesTab,
    canSeeImportMaterialTab,
    canSeeMaterialsTab,
    canSeeWorkOrdersTab,
    canSeeFieldReportsTab,
    canSeeFilesTab,
    showFinancesTab,
    showQuotesTab,
  ]);

  const activeWorkOrdersForUi = useMemo(() => {
    const base = (jobWorkOrders ?? []).filter((w) => w.status !== "completed" && w.status !== "canceled");
    if (!isProductionWorkOrderPhaseDeferred()) return base;
    return base.filter((w) => w.type !== "production");
  }, [jobWorkOrders]);

  const handleStatusChange = (newStatus: JobStatus) => {
    if (id && job) {
      const totalPaid = jobPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      const unpaidBalance = Math.max(0, (Number(job.totalPrice) || 0) - totalPaid);
      if (newStatus === "completed" && unpaidBalance > 0.009) {
        toast.error("Status ne može na „Završen“ dok posao nije u potpunosti isplaćen.");
        return;
      }
      updateJobStatus.mutate({ id, status: newStatus });
    }
  };

  const handleWarrantyOrServiceSubmit = async () => {
    if (!id) return;
    const d = (warrantyScheduledDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      toast.error("Unesite planirani datum obilaska.");
      return;
    }
    if (warrantyAttachmentFile && !authUser?.id) {
      toast.error("Morate biti ulogovani da otpremite prilog.");
      return;
    }
    setWarrantySubmitting(true);
    try {
      let attachmentFileId: string | undefined;
      if (warrantyAttachmentFile && authUser?.id) {
        const up = await uploadFile.mutateAsync({
          jobId: id,
          category: "work_order",
          file: warrantyAttachmentFile,
          uploadedBy: authUser.id,
        });
        attachmentFileId = up.id;
      }
      await openWarrantyOrServiceFromCompletedJob(supabase, {
        jobId: id,
        kind: warrantyKind,
        scheduledVisitDate: d,
        notes: warrantyNotes.trim(),
        actorUserId: authUser?.id ?? null,
        attachmentFileId: attachmentFileId ?? null,
      });
      toast.success(warrantyKind === "complaint" ? "Reklamacija je otvorena." : "Servis je otvoren.");
      setWarrantyModalOpen(false);
      setWarrantyNotes("");
      setWarrantyAttachmentFile(null);
      await queryClient.invalidateQueries({ queryKey: ["job", id] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders", id] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Greška pri čuvanju.");
    } finally {
      setWarrantySubmitting(false);
    }
  };

  const isLoading = isLoadingJob || isLoadingRelated;

  const measurementPending = createWorkOrder.isPending || updateWorkOrder.isPending || updateJobStatus.isPending;

  const clearOpenDetailWorkOrderId = useCallback(() => setOpenDetailWorkOrderId(null), []);

  const resolveInstallationWorkOrderForSchedule = useCallback(() => {
    const instActive = jobWorkOrders
      .filter((w) => w.type === "installation" && (w.status === "pending" || w.status === "in_progress"))
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime(),
      )[0];
    const instCanceled = jobWorkOrders
      .filter((w) => w.type === "installation" && w.status === "canceled")
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime(),
      );
    return instActive ?? instCanceled[0];
  }, [jobWorkOrders]);

  const resolveMeasurementWorkOrderForSchedule = useCallback(() => {
    const measPending = jobWorkOrders.find(
      (w) => w.type === "measurement" && w.status === "pending" && !w.assignedTeamId,
    );
    if (measPending) return measPending;
    const measCanceled = jobWorkOrders
      .filter((w) => w.type === "measurement" && w.status === "canceled")
      .sort(
        (a, b) =>
          new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime(),
      );
    return measCanceled[0];
  }, [jobWorkOrders]);

  const toDateTimeLocalInput = (value: string | undefined | null): string => {
    if (!value?.trim()) return "";
    const ymd = normalizeWorkOrderDateYmd(value);
    if (!ymd) return "";
    if (!isoHasExplicitScheduleTime(value)) return `${ymd}T08:00`;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return `${ymd}T08:00`;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openInstallationScheduleModal = useCallback(() => {
    const instWo = resolveInstallationWorkOrderForSchedule();
    setInstallationTeamId(instWo?.assignedTeamId ?? "");
    const fromJob = job?.scheduledDate ? toDateTimeLocalInput(job.scheduledDate) : "";
    const fromWo = instWo?.date ? toDateTimeLocalInput(instWo.date) : "";
    const initialDt = fromJob || fromWo || "";
    setInstallationDateTime(initialDt);
    setInstallationPriorDateYmd(initialDt ? initialDt.slice(0, 10) : null);
    setInstallationNote("");
    setInstallationChecklist([]);
    setInstallationChecklistDraft("");
    setInstallationAttachmentFile(null);
    setInstallationModalOpen(true);
  }, [job?.scheduledDate, resolveInstallationWorkOrderForSchedule]);

  const handleScheduleMeasurement = async () => {
    if (!id) return;
    if (!measurementDateTime.trim()) {
      toast.error("Unesite datum i vreme merenja");
      return;
    }
    if (!measurementTeamId.trim()) {
      toast.error("Izaberite tim/radnika za merenje");
      return;
    }
    if (measurementAttachmentFile && !authUser?.id) {
      toast.error("Morate biti ulogovani da otpremite prilog.");
      return;
    }

    const selectedTeam = teams?.find((t) => t.id === measurementTeamId);
    const teamLabel = selectedTeam?.name ?? "Nepoznat tim";
    const scheduledDate = measurementDateTime.slice(0, 10);
    const scheduledDatetime = workOrderScheduledDatetimeForDb(measurementDateTime) ?? scheduledDate;
    const dateDisplay = formatDateByAppLanguage(scheduledDate) || scheduledDate;
    const timeDisplay = measurementDateTime.slice(11, 16) || "—";

    const descriptionParts = [
      `Zakazano merenje (${dateDisplay} ${timeDisplay})`,
      measurementNote.trim() ? `Napomena: ${measurementNote.trim()}` : "",
    ].filter(Boolean);

    const trimmedChecklistLines = measurementChecklist.map((s) => s.trim()).filter((s) => s.length > 0);

    try {
      let attachmentFileId: string | undefined;
      if (measurementAttachmentFile && authUser?.id) {
        const up = await uploadFile.mutateAsync({
          jobId: id,
          category: "work_order",
          file: measurementAttachmentFile,
          uploadedBy: authUser.id,
        });
        attachmentFileId = up.id;
      }

      const existingMeasWo = resolveMeasurementWorkOrderForSchedule();
      const schedulingDescription = descriptionParts.join(" | ");

      if (existingMeasWo) {
        const baseUpdate: {
          date: string;
          team_id: string;
          description: string;
          status?: "pending";
          file_id?: string;
        } = {
          date: scheduledDatetime,
          team_id: measurementTeamId,
          description: schedulingDescription,
        };
        if (existingMeasWo.status === "canceled") {
          baseUpdate.status = "pending";
        }
        if (attachmentFileId) {
          baseUpdate.file_id = attachmentFileId;
        }
        const { error: woErr } = await supabase.from("work_orders").update(baseUpdate).eq("id", existingMeasWo.id);
        if (woErr) throw woErr;

        if (trimmedChecklistLines.length > 0) {
          const { error: itemsErr } = await supabase.from("work_order_items").insert(
            trimmedChecklistLines.map((desc) => ({
              work_order_id: existingMeasWo.id,
              description: desc,
              is_completed: false,
              measurements: "",
            })),
          );
          if (itemsErr) throw itemsErr;
        }

        await updateJobStatus.mutateAsync({ id, status: "measuring" });

        const reopened = existingMeasWo.status === "canceled";
        await upsertSystemActivity({
          jobId: id,
          description: reopened
            ? `Merenje ponovo zakazano za ${dateDisplay} u ${timeDisplay}, dodeljeno: ${teamLabel}${measurementNote.trim() ? `, napomena: ${measurementNote.trim()}` : ""} (RN merenja vraćen u „na čekanju”).`
            : `Merenje zakazano za ${dateDisplay} u ${timeDisplay}, dodeljeno: ${teamLabel}${measurementNote.trim() ? `, napomena: ${measurementNote.trim()}` : ""}.`,
          systemKey: `measurement-scheduled:${existingMeasWo.id}${reopened ? ":reopen" : ""}`,
          authorId: authUser?.id ?? null,
        });
      } else {
        const created = await createWorkOrder.mutateAsync({
          jobId: id,
          type: "measurement",
          description: schedulingDescription,
          assignedTeamId: measurementTeamId,
          date: scheduledDatetime,
          status: "pending",
          ...(attachmentFileId ? { attachmentFileId } : {}),
          ...(trimmedChecklistLines.length > 0 ? { checklistItems: trimmedChecklistLines } : {}),
        });

        await updateJobStatus.mutateAsync({ id, status: "measuring" });

        await upsertSystemActivity({
          jobId: id,
          description: `Merenje zakazano za ${dateDisplay} u ${timeDisplay}, dodeljeno: ${teamLabel}${measurementNote.trim() ? `, napomena: ${measurementNote.trim()}` : ""}`,
          systemKey: `measurement-scheduled:${created.id}`,
        });
      }

      try {
        await recomputeJobStatus(id, authUser?.id ?? null);
      } catch (reErr) {
        console.warn("recomputeJobStatus posle zakazivanja merenja:", reErr);
      }

      setMeasurementModalOpen(false);
      setMeasurementDateTime("");
      setMeasurementTeamId("");
      setMeasurementNote("");
      setMeasurementChecklist([]);
      setMeasurementChecklistDraft("");
      setMeasurementAttachmentFile(null);
      await queryClient.invalidateQueries({ queryKey: ["job", id] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders", id] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["activities", id] });
      void queryClient.invalidateQueries({ queryKey: ["work-order-schedule-calendar"] });
      toast.success("Merenje je uspešno zakazano");
    } catch (err) {
      console.error("Schedule measurement failed:", err);
      toast.error("Zakazivanje merenja nije uspelo. Status posla nije promenjen.");
    }
  };

  const handleScheduleInstallation = async () => {
    if (!id) return;
    if (!installationDateTime.trim()) {
      toast.error("Unesite datum i vreme ugradnje");
      return;
    }
    if (!installationTeamId.trim()) {
      toast.error("Izaberite montažni tim");
      return;
    }
    const dateStr = installationDateTime.slice(0, 10);
    const scheduledDatetime = workOrderScheduledDatetimeForDb(installationDateTime) ?? dateStr;
    const timeDisplay = installationDateTime.length >= 16 ? installationDateTime.slice(11, 16) : "—";
    const dateDisplay = formatDateByAppLanguage(dateStr) || dateStr;
    const selectedTeam = teams?.find((t) => t.id === installationTeamId);
    const teamLabel = selectedTeam?.name ?? "Nepoznat tim";
    let scheduledIso: string;
    try {
      scheduledIso = new Date(installationDateTime).toISOString();
    } catch {
      toast.error("Neispravan datum ili vreme");
      return;
    }
    if (installationAttachmentFile && !authUser?.id) {
      toast.error("Morate biti ulogovani da otpremite prilog.");
      return;
    }

    const descriptionParts = [
      `Zakazana ugradnja (${dateDisplay} ${timeDisplay})`,
      installationNote.trim() ? `Napomena: ${installationNote.trim()}` : "",
    ].filter(Boolean);
    const schedulingDescription = descriptionParts.join(" | ");
    const trimmedChecklistLines = installationChecklist.map((s) => s.trim()).filter((s) => s.length > 0);

    setInstallationSchedulePending(true);
    try {
      let attachmentFileId: string | undefined;
      if (installationAttachmentFile && authUser?.id) {
        const up = await uploadFile.mutateAsync({
          jobId: id,
          category: "work_order",
          file: installationAttachmentFile,
          uploadedBy: authUser.id,
        });
        attachmentFileId = up.id;
      }

      const instWo = resolveInstallationWorkOrderForSchedule();

      let targetWoId = instWo?.id;
      let reopened = instWo?.status === "canceled";

      if (!instWo) {
        const { data: newWo, error: createError } = await supabase
          .from("work_orders")
          .insert({
            job_id: id,
            type: "installation",
            status: "pending",
            date: scheduledDatetime,
            team_id: installationTeamId,
            description: schedulingDescription,
            ...(attachmentFileId ? { file_id: attachmentFileId } : {}),
          })
          .select()
          .single();

        if (createError) throw createError;
        targetWoId = newWo.id;
        reopened = false;
      } else {
        const existingDesc = (instWo.description ?? "").trim();
        const isAutoDesc = /automatski|^\s*\[AUTO\]/i.test(existingDesc);
        const nextDescription =
          isAutoDesc || !existingDesc ? schedulingDescription : `${existingDesc} | ${schedulingDescription}`;
        const baseUpdate: {
          date: string;
          team_id: string;
          description: string;
          status?: "pending";
          file_id?: string;
        } = {
          date: scheduledDatetime,
          team_id: installationTeamId,
          description: nextDescription,
        };
        if (instWo.status === "canceled") {
          baseUpdate.status = "pending";
        }
        if (attachmentFileId) {
          baseUpdate.file_id = attachmentFileId;
        }
        const { error: woErr } = await supabase.from("work_orders").update(baseUpdate).eq("id", targetWoId!);
        if (woErr) throw woErr;
      }

      if (trimmedChecklistLines.length > 0 && targetWoId) {
        const { error: itemsErr } = await supabase.from("work_order_items").insert(
          trimmedChecklistLines.map((description) => ({
            work_order_id: targetWoId,
            description,
            is_completed: false,
            measurements: "",
          })),
        );
        if (itemsErr) throw itemsErr;
      }

      const { error: jobErr } = await supabase.from("jobs").update({ scheduled_date: scheduledIso }).eq("id", id);
      if (jobErr) throw jobErr;

      const { data: authData } = await supabase.auth.getUser();
      const actor = authData.user?.id ?? authUser?.id ?? null;
      await upsertSystemActivity({
        jobId: id,
        description: reopened
          ? `Ugradnja ponovo zakazana za ${dateDisplay} u ${timeDisplay}, dodeljeno: ${teamLabel}${installationNote.trim() ? `, napomena: ${installationNote.trim()}` : ""} (RN ugradnje vraćen u „na čekanju”).`
          : `Ugradnja zakazana za ${dateDisplay} u ${timeDisplay}, dodeljeno: ${teamLabel}${installationNote.trim() ? `, napomena: ${installationNote.trim()}` : ""}.`,
        systemKey: `installation-scheduled:${id}:${scheduledIso}${reopened ? ":reopen" : ""}`,
        authorId: actor,
      });

      try {
        await recomputeJobStatus(id, actor);
      } catch (reErr) {
        console.warn("recomputeJobStatus posle zakazivanja ugradnje:", reErr);
      }

      await queryClient.invalidateQueries({ queryKey: ["job", id] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders", id] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["activities", id] });
      await queryClient.invalidateQueries({ queryKey: DASHBOARD_WORK_ORDERS_MISSING_TEAM_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: DASHBOARD_ACCEPTED_MEASUREMENT_FROM_JOBS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: DASHBOARD_NEEDS_INSTALLATION_SCHEDULE_FROM_JOBS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["field-reports", id] });
      void queryClient.invalidateQueries({ queryKey: ["work-order-schedule-calendar"] });

      setInstallationModalOpen(false);
      setInstallationDateTime("");
      setInstallationTeamId("");
      setInstallationNote("");
      setInstallationChecklist([]);
      setInstallationChecklistDraft("");
      setInstallationAttachmentFile(null);
      toast.success(reopened ? "Nalog ugradnje je ponovo otvoren i zakazan." : "Ugradnja je zakazana");
    } catch (err) {
      console.error("Schedule installation failed:", err);
      const message = err instanceof Error ? err.message : "Nepoznata greška";
      toast.error("Zakazivanje ugradnje nije uspelo", { description: message });
    } finally {
      setInstallationSchedulePending(false);
    }
  };

  const handleConfirmCancelEntireJob = () => {
    if (!id) return;
    setFullJobCancelOpen(false);
    updateJobStatus.mutate({ id, status: "canceled" });
  };

  if (isLoading) return <AppLayout title="Učitavanje..."><DetailSkeleton /></AppLayout>;

  if (error || !job) {
    return (
      <AppLayout title="Greška">
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h2 className="text-xl font-bold mb-2">Posao nije pronađen</h2>
          <p className="text-muted-foreground mb-6">Traženi posao ne postoji ili nemate dozvolu da mu pristupite.</p>
          <Button onClick={() => navigate(listReturn?.returnTo ?? "/jobs")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> {listReturn?.returnLabel ?? "Nazad na poslove"}
          </Button>
        </div>
      </AppLayout>
    );
  }


  const statusOptionsForJob = jobStatusOptionsForSelect(job);
  const childStatusUnexpected = isChildJobStatusUnexpected(job);
  const jobStatusBadgeLabel = jobStatusLabelForDisplay(job);

  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const estimatedPriceDisplay = job.totalPrice > 0 ? formatCurrency(job.totalPrice) : "-";
  const pendingMaterials = jobMaterials.filter((m) => !materialOrderDeliveryResolved(m.deliveryStatus));
  const totalPaid = jobPayments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const paidPercent = job.totalPrice > 0 ? Math.round((totalPaid / job.totalPrice) * 100) : 0;

  const hasInstallationPlan = jobWorkOrders.some(
    (w) => w.type === "installation" && w.status !== "canceled",
  );

  const missingFields: string[] = [];
  if (!job.scheduledDate && !hasInstallationPlan) {
    missingFields.push("Datum ugradnje nije zakazan");
  }
  if (job.unpaidBalance > 0 && jobPayments.length === 0) missingFields.push("Nema evidentiranih uplata");

  const copyJobNumber = () => {
    navigator.clipboard.writeText(job.jobNumber);
    toast.success("Broj posla kopiran");
  };

  const installationAddressDisplay = getInstallationAddressForDisplay(job);
  const installationScheduleDisplay = getJobInstallationScheduleDisplay(job, jobWorkOrders);
  const scheduleKpiValue = installationScheduleDisplay ?? "—";
  const createdAtDisplay = formatDateByAppLanguage(job.createdAt) || job.createdAt;
  const canPlanInstallation =
    canPerformAction("create_work_order") ||
    canPerformAction("edit_work_order") ||
    canPerformAction("update_job_status");

  const openInstallationWorkOrders = jobWorkOrders.filter(
    (w) => w.type === "installation" && (w.status === "pending" || w.status === "in_progress"),
  );
  const installationSchedulingComplete = jobInstallationSchedulingComplete(job, openInstallationWorkOrders);
  const canScheduleInstallation =
    canPlanInstallation && job.status === "scheduled" && !installationSchedulingComplete;

  const hasOpenInstallationWo = openInstallationWorkOrders.length > 0;
  const hasInstallationSiteCanceledReport = jobFieldReports.some(
    (r) => r.siteCanceled && r.workOrderType === "installation",
  );
  const canRescheduleAfterSiteCancel =
    canPlanInstallation &&
    (job.status === "installation_problem" || (hasInstallationSiteCanceledReport && !hasOpenInstallationWo));

  const isMeasurementKindWo = (w: { type: string }) =>
    w.type === "measurement" || w.type === "measurement_verification";
  const isMeasurementKindReport = (r: { workOrderType?: string }) =>
    r.workOrderType === "measurement" || r.workOrderType === "measurement_verification";
  const hasCanceledMeasurementWo = jobWorkOrders.some(
    (w) => isMeasurementKindWo(w) && w.status === "canceled",
  );
  const hasMeasurementProblemReport = jobFieldReports.some(
    (r) =>
      isMeasurementKindReport(r) && (r.siteCanceled || r.everythingOk === false),
  );
  const hasOpenScheduledMeasurementWo = jobWorkOrders.some(
    (w) =>
      isMeasurementKindWo(w) &&
      (w.status === "pending" || w.status === "in_progress") &&
      !!w.assignedTeamId,
  );
  const isMeasurementReschedule =
    canPerformAction("create_work_order") &&
    (job.status === "accepted" || job.status === "measuring") &&
    !isAdditionalWorksChildJob(job) &&
    !hasOpenScheduledMeasurementWo &&
    (hasCanceledMeasurementWo || hasMeasurementProblemReport);
  const canShowMeasurementScheduleButton =
    canPerformAction("create_work_order") &&
    (job.status === "accepted" || job.status === "measuring") &&
    !isAdditionalWorksChildJob(job) &&
    (isMeasurementReschedule || !hasOpenScheduledMeasurementWo);

  const canOpenWarrantyOrService =
    job.status === "completed" &&
    (canPerformAction("create_work_order") || canPerformAction("update_job_status"));
  const canConfirmProductionDone = canPerformAction("update_job_status") || currentRole === "procurement";

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[
          { label: "Kupci / Poslovi", href: "/jobs" },
          { label: `${job.jobNumber}` },
        ]} />

        {/* ── Header ── */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(listReturn?.returnTo ?? "/jobs")}
            className="mb-3 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            {listReturn?.returnLabel ?? "Nazad na listu poslova"}
          </Button>

          <div className="bg-card rounded-xl border border-border p-4 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold text-foreground">{job.jobNumber}</h1>
                  <button onClick={copyJobNumber} className="text-muted-foreground hover:text-foreground"><Copy className="w-3.5 h-3.5" /></button>
                  {childStatusUnexpected ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={job.status} labelOverride={jobStatusBadgeLabel} />
                      <span className="text-xs text-muted-foreground max-w-xs leading-snug">
                        Neočekivan status za pod-posao. Osvežite stranicu; ako ostane, ponovo sačuvajte uplatu ili
                        kontaktirajte administratora.
                      </span>
                    </div>
                  ) : (
                  <Select onValueChange={handleStatusChange} value={job.status}>
                    <SelectTrigger
                      className="h-7 w-fit bg-transparent border-none p-0 focus:ring-0"
                      title={jobStatusDisplayHint(job)}
                    >
                      <StatusBadge status={job.status} labelOverride={jobStatusBadgeLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptionsForJob.map((key) => {
                        const config = JOB_STATUS_CONFIG[key];
                        const optionLabel = jobStatusLabelForDisplay(job, key) ?? config.label;
                        return (
                          <SelectItem key={key} value={key} title={config.automationHint}>
                            {optionLabel}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  )}
                  {canPerformAction("update_job_status") && currentRole !== "office" && currentRole !== "procurement" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() =>
                        toggleJobStatusLock.mutate({
                          id: job.id,
                          locked: !(job.statusLocked === true),
                        })
                      }
                      title={job.statusLocked ? "Otključaj automatske promene statusa" : "Zaključaj automatske promene statusa"}
                    >
                      {job.statusLocked ? (
                        <>
                          <Lock className="w-3.5 h-3.5 mr-1" />
                          Status lock
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5 mr-1" />
                          Status auto
                        </>
                      )}
                    </Button>
                  )}
                  <OverduePaymentBadge job={job} />
                </div>
                <p className="text-base font-medium text-foreground">{job.customer.fullName}</p>
                <p className="text-sm text-muted-foreground">{job.summary}</p>
                {isAdditionalWorksChildJob(job) && parentJobSummaryQuery.data?.job_number ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <GenericBadge
                      variant="info"
                      label={`Dodatni radovi za posao #${parentJobSummaryQuery.data.job_number}`}
                    />
                    <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                      <Link to={`/jobs/${parentJobSummaryQuery.data.id}`}>Otvori glavni posao</Link>
                    </Button>
                  </div>
                ) : null}
                {!isAdditionalWorksChildJob(job) && (childJobsQuery.data?.length ?? 0) > 0 ? (
                  <div className="mt-2 rounded-lg border border-sky-500/35 bg-sky-500/[0.06] dark:bg-sky-950/20 px-3 py-2.5 text-sm">
                    <p className="text-xs font-semibold text-sky-900 dark:text-sky-200 uppercase tracking-wide mb-1.5">
                      Vezani dodatni poslovi
                    </p>
                    <ul className="space-y-1">
                      {childJobsQuery.data!.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <Link to={`/jobs/${c.id}`} className="font-medium text-primary hover:underline">
                            #{c.job_number}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {JOB_STATUS_CONFIG[c.status]?.label ?? c.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-1">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" /> Kreirao: {job.createdBy?.name ?? "—"}
                  </span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Kreiran: {createdAtDisplay}</span>
                  {installationScheduleDisplay && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Zakazan: {installationScheduleDisplay}
                    </span>
                  )}
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {installationAddressDisplay}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {canShowMeasurementScheduleButton && (
                  <Button size="sm" onClick={() => setMeasurementModalOpen(true)}>
                    {isMeasurementReschedule ? "Ponovo zakaži merenje" : "Zakaži merenje"}
                  </Button>
                )}
                {(canScheduleInstallation || canRescheduleAfterSiteCancel) && (
                  <Button size="sm" variant="secondary" onClick={openInstallationScheduleModal}>
                    {canRescheduleAfterSiteCancel ? "Ponovo zakazite ugradnju" : "Zakaži ugradnju"}
                  </Button>
                )}
                {canRescheduleAfterSiteCancel && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => setFullJobCancelOpen(true)}
                    disabled={updateJobStatus.isPending}
                  >
                    Otkaži ceo posao
                  </Button>
                )}
                {canOpenWarrantyOrService && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setWarrantyKind("complaint");
                      setWarrantyNotes("");
                      const t = new Date();
                      setWarrantyScheduledDate(
                        `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`,
                      );
                      setWarrantyModalOpen(true);
                    }}
                  >
                    Otvori Reklamaciju/Servis
                  </Button>
                )}
                {showQuotesTab &&
                  (isAdditionalWorksChildJob(job) ||
                    job.status === "measurement_processing" ||
                    job.status === "final_quote_sent" ||
                    job.status === "final_quote_accepted_pending_payment") && (
                  <Button size="sm" variant="default" onClick={() => setActiveTab("quotes")}>
                    Ponude
                  </Button>
                )}
                {canPerformAction("edit_job") && (
                  <NewJobModal
                    job={job}
                    trigger={<Button variant="outline" size="sm">Izmeni</Button>}
                  />
                )}
                {canPerformAction("add_activity") && <AddActivityModal />}
              </div>
            </div>
            {(job.status === "ready_for_work" || job.status === "waiting_material") &&
              !(job.statusLocked === true) &&
              (currentRole === "office" ? (
                <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-muted/40 px-3 py-3">
                  <p className="text-sm text-muted-foreground flex-1">
                    Čeka se nabavka da završi narudžbine i da budu primljene.
                  </p>
                </div>
              ) : canPerformAction("update_job_status") ? (
                <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-muted/40 px-3 py-3">
                  <p className="text-sm text-muted-foreground flex-1">
                    Materijal je već dostupan na stanju? Možete odmah preći u „U proizvodnju” bez prolaska kroz kompletan tok nabavke u aplikaciji.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="shrink-0 border-border whitespace-normal text-left sm:text-center sm:whitespace-normal"
                    disabled={updateJobStatus.isPending}
                    onClick={() => handleStatusChange("in_production")}
                  >
                    📦 Materijal je na stanju - Prebaci u proizvodnju
                  </Button>
                </div>
              ) : null)}
          </div>
        </div>

        {/* ── KPI Strip ── */}
        {showFinancesTab && (
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 sm:gap-3 mb-5">
            {[
              { icon: DollarSign, value: estimatedPriceDisplay, label: "Cena", color: "text-foreground" },
              { icon: DollarSign, value: `${paidPercent}%`, label: "Naplaćeno", color: "text-success" },
              { icon: DollarSign, value: formatCurrency(job.unpaidBalance), label: "Preostalo", color: job.unpaidBalance > 0 ? "text-destructive" : "text-success" },
              { icon: Package, value: String(pendingMaterials.length), label: "Čeka materijal", color: pendingMaterials.length > 0 ? "text-warning" : "text-foreground" },
              { icon: ClipboardList, value: String(activeWorkOrdersForUi.length), label: "Aktivni nalozi", color: "text-info" },
              { icon: Calendar, value: scheduleKpiValue, label: "Zakazano", color: "text-foreground" },
            ].map((kpi, i) => (
              <div key={i} className="bg-card rounded-lg border border-border p-3 text-center">
                <kpi.icon className={`w-4 h-4 mx-auto mb-1 ${kpi.color}`} />
                <p className={`text-sm sm:text-base font-bold ${kpi.color} truncate`}>{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
              </div>
            ))}
          </div>
        )}

        {!showFinancesTab && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
            {[
              { icon: Package, value: String(pendingMaterials.length), label: "Čeka materijal", color: pendingMaterials.length > 0 ? "text-warning" : "text-foreground" },
              { icon: ClipboardList, value: String(activeWorkOrdersForUi.length), label: "Aktivni nalozi", color: "text-info" },
              { icon: Calendar, value: scheduleKpiValue, label: "Zakazano", color: "text-foreground" },
              { icon: MapPin, value: installationAddressDisplay, label: "Lokacija", color: "text-foreground" },
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

        {isAdditionalWorksChildJob(job) && job.status === "final_quote_accepted_pending_payment" && (
          <Alert className="mb-4 border-teal-600/25 bg-teal-500/5">
            <Info className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            <AlertTitle>Pod-posao: čeka uplatu pre „Spremno za rad“</AlertTitle>
            <AlertDescription className="mt-2 space-y-2 text-sm">
              <p>
                Ponuda je prihvaćena. Status posla automatski prelazi u „Spremno za rad“ čim u finansijama
                evidentirate uplatu (pozitivan iznos, posle trenutka prihvata ponude). Do tada ostaje ovaj korak u
                sistemu.
              </p>
              {showFinancesTab && (
                <Button type="button" variant="outline" size="sm" onClick={() => setActiveTab("finances")}>
                  Otvori finansije / uplate
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {(job.status === "in_production" || job.status === "partial_in_production") &&
          isProductionWorkOrderPhaseDeferred() &&
          canConfirmProductionDone &&
          job.statusLocked !== true && (
            <Alert className="mb-4 border-primary/35 bg-primary/5">
              <ClipboardList className="h-4 w-4" />
              <AlertTitle>Proizvodnja u drugoj fazi</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>
                  Radni nalozi proizvodnje trenutno nisu u ovom CRM-u. Kada je proizvodnja u pogonu završena, potvrdite
                  ispod — posao prelazi u „{JOB_STATUS_CONFIG.scheduled.label}“ i može se kreirati / nastaviti ugradnja.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={confirmJobProductionDone.isPending}
                    onClick={() => confirmJobProductionDone.mutate({ id: job.id })}
                  >
                    Da, proizvodnja je završena
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="bg-muted w-max sm:w-full justify-start">
              <TabsTrigger value="overview" className="text-xs sm:text-sm">Pregled</TabsTrigger>
              {canSeeActivitiesTab && <TabsTrigger value="activities" className="text-xs sm:text-sm">Aktivnosti <span className="hidden sm:inline ml-1">({jobActivities.length})</span></TabsTrigger>}
              {showFinancesTab && <TabsTrigger value="finances" className="text-xs sm:text-sm">Finansije</TabsTrigger>}
              {showQuotesTab && (
                <TabsTrigger value="quotes" className="text-xs sm:text-sm">
                  Ponude <span className="hidden sm:inline ml-1">({jobQuotes.length})</span>
                </TabsTrigger>
              )}
              {canSeeImportMaterialTab && (
                <TabsTrigger value="import-material" className="text-xs sm:text-sm">
                  Krojna lista <span className="hidden sm:inline ml-1">({jobItems.length})</span>
                </TabsTrigger>
              )}
              {canSeeMaterialsTab && (
                <TabsTrigger value="materials" className="text-xs sm:text-sm">
                  Priprema proizvodnje / Nabavka <span className="hidden sm:inline ml-1">({jobMaterials.length})</span>
                </TabsTrigger>
              )}
              {canSeeWorkOrdersTab && <TabsTrigger value="work-orders" className="text-xs sm:text-sm">Radni nalozi <span className="hidden sm:inline ml-1">({jobWorkOrders.length})</span></TabsTrigger>}
              {canSeeFieldReportsTab && <TabsTrigger value="field-reports" className="text-xs sm:text-sm">Terenski izveštaji <span className="hidden sm:inline ml-1">({jobFieldReports.length})</span></TabsTrigger>}
              {canSeeFilesTab && (
                <TabsTrigger value="files" className="text-xs sm:text-sm">
                  Fajlovi <span className="hidden sm:inline ml-1">({jobFiles.length})</span>
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="overview" forceMount={activeTab === "overview" ? true : undefined} hidden={activeTab !== "overview"}>
            <TabTransition key="overview">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Customer info */}
                <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                  <SectionHeader title="Podaci o kupcu" icon={Building2} />
                  <p className="text-xs text-muted-foreground mb-3">
                    Klijent: <span className="text-foreground font-medium">{job.customer.fullName}</span> ({job.customer.customerNumber}).
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
                  {(() => {
                    const extraPhones = job.customer.phones.filter(
                      (p) => p && (!job.customerPhone || p !== job.customerPhone),
                    );
                    const showEmails = hasAccess("activities") && job.customer.emails.length > 0;
                    const showPhones =
                      showCustomerPhones && (Boolean(job.customerPhone) || extraPhones.length > 0);
                    const showBlock = showPhones || showEmails;
                    if (!showBlock) return null;

                    return (
                      <div className="space-y-1.5 text-sm border-t border-border pt-3">
                        {showCustomerPhones && job.customerPhone && (
                          <div className="flex items-center gap-2 text-foreground font-medium">
                            <Phone className="w-3.5 h-3.5 shrink-0" />
                            <span>Telefon za ovaj posao: {job.customerPhone}</span>
                          </div>
                        )}
                        {showCustomerPhones &&
                          extraPhones.map((p, i) => (
                            <div key={i} className="flex items-center gap-2 text-muted-foreground">
                              <Phone className="w-3.5 h-3.5 shrink-0" /> <span>{p}</span>
                            </div>
                          ))}
                        {showEmails &&
                          job.customer.emails.map((e, i) => (
                            <div key={i} className="flex items-center gap-2 text-muted-foreground">
                              <Mail className="w-3.5 h-3.5 shrink-0" /> <span>{e}</span>
                            </div>
                          ))}
                      </div>
                    );
                  })()}
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
                    <p className="text-sm text-muted-foreground">{installationAddressDisplay}</p>
                    <AddressMiniMap address={installationAddressDisplay} />
                  </div>
                </div>

                {/* Pending materials */}
                {pendingMaterials.length > 0 && (
                  <div className="bg-card rounded-xl border border-warning/20 p-4 sm:p-5">
                    <SectionHeader title="Materijal na čekanju" subtitle={`${pendingMaterials.length} stavki`} icon={Package} />
                    <div className="space-y-2.5">
                      {pendingMaterials.map(m => (
                        <div key={m.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{labelMaterialType(m.materialType)}</span>
                            <span className="text-xs text-muted-foreground">— {m.supplier}</span>
                            <DelayedDeliveryBadge order={m} />
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatMaterialOrderDateForDisplay(m.expectedDelivery) || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active work orders */}
                {currentRole !== "procurement" && activeWorkOrdersForUi.length > 0 && (
                  <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
                    <SectionHeader title="Aktivni radni nalozi" subtitle={`${activeWorkOrdersForUi.length} naloga`} icon={ClipboardList} />
                    <div className="space-y-2.5">
                      {activeWorkOrdersForUi.map((w) => {
                        const rowInner = (
                          <>
                            <div className="flex flex-col min-w-0 gap-0.5">
                              <div className="flex items-center gap-2">
                                <GenericBadge label={w.status === "in_progress" ? "U toku" : "Čeka"} variant={w.status === "in_progress" ? "info" : "warning"} />
                                <span className="font-medium text-foreground">{labelWorkOrderType(w.type)}</span>
                              </div>
                              <span className="truncate text-muted-foreground">{w.description.slice(0, 52)}{w.description.length > 52 ? "…" : ""}</span>
                            </div>
                            <div className="text-xs text-muted-foreground text-right shrink-0 space-y-0.5">
                              <p className="whitespace-nowrap">
                                {formatWorkOrderScheduleDisplay({
                                  date: w.date,
                                  description: w.description,
                                  type: w.type,
                                  jobScheduledAt: w.type === "installation" ? job?.scheduledAt : undefined,
                                }) || w.date}
                              </p>
                              <p className="whitespace-nowrap max-w-[10rem] truncate" title={w.assignedTeamName || w.assignedTeamId}>
                                {w.assignedTeamName || w.assignedTeamId || "—"}
                              </p>
                            </div>
                          </>
                        );
                        return hasAccess("work-orders") ? (
                          <button
                            key={w.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-2 text-sm bg-muted/50 rounded-lg p-2.5 text-left hover:bg-muted transition-colors"
                            onClick={() => {
                              setActiveTab("work-orders");
                              setOpenDetailWorkOrderId(w.id);
                            }}
                          >
                            {rowInner}
                          </button>
                        ) : (
                          <div key={w.id} className="flex items-center justify-between gap-2 text-sm bg-muted/50 rounded-lg p-2.5">
                            {rowInner}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </TabTransition>
          </TabsContent>

          {canSeeActivitiesTab && (
          <TabsContent value="activities">
              <TabTransition key="activities">
                <ActivitiesTab activities={jobActivities} showOriginFilter />
              </TabTransition>
            </TabsContent>
          )}
          {showFinancesTab && (
            <TabsContent value="finances">
              <TabTransition key="finances">
                <FinancesTab job={job} payments={jobPayments} quotes={jobQuotes} updateJobPricing={updateJobPricing} />
              </TabTransition>
            </TabsContent>
          )}
          {showQuotesTab && (
            <TabsContent value="quotes">
              <TabTransition key="quotes">
                <QuotesTab
                  jobId={id!}
                  jobStatus={job.status}
                  isChildJob={Boolean(job.parentJobId?.trim())}
                  quotes={jobQuotes}
                  customerEmail={job.customer.emails[0]}
                  customerName={job.customer.fullName}
                  customerAddress={
                    job.customer.billingAddress?.trim() ||
                    job.customer.installationAddress?.trim() ||
                    undefined
                  }
                />
              </TabTransition>
            </TabsContent>
          )}
          {canSeeImportMaterialTab && (
            <TabsContent value="import-material">
              <TabTransition key="import-material">
                <ProductionMaterialTab jobId={id!} mode="import" />
              </TabTransition>
            </TabsContent>
          )}
          {canSeeMaterialsTab && (
            <TabsContent value="materials">
              <TabTransition key="materials">
                <MaterialOrdersTab orders={jobMaterials} jobId={id} />
              </TabTransition>
            </TabsContent>
          )}
          {canSeeWorkOrdersTab && (
            <TabsContent value="work-orders">
              <TabTransition key="work-orders">
                <WorkOrdersTab
                  jobId={id!}
                  openDetailWorkOrderId={openDetailWorkOrderId}
                  onOpenDetailWorkOrderIdConsumed={clearOpenDetailWorkOrderId}
                />
              </TabTransition>
            </TabsContent>
          )}
          {canSeeFieldReportsTab && (
            <TabsContent value="field-reports"><TabTransition key="field-reports"><FieldReportsTab reports={jobFieldReports} /></TabTransition></TabsContent>
          )}
          {canSeeFilesTab && (
            <TabsContent value="files"><TabTransition key="files"><FilesTab files={jobFiles} /></TabTransition></TabsContent>
          )}
        </Tabs>
      </PageTransition>
      <Dialog
        open={measurementModalOpen}
        onOpenChange={(open) => {
          setMeasurementModalOpen(open);
          if (!open) setMeasurementAttachmentFile(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isMeasurementReschedule ? "Ponovo zakaži merenje" : "Zakaži merenje"}</DialogTitle>
            <DialogDescription>
              {isMeasurementReschedule
                ? "Postojeći nalog merenja se ažurira sa novim terminom i timom."
                : `Posao ostaje u statusu „${JOB_STATUS_CONFIG.accepted.label}“ dok ne sačuvate zakazivanje merenja.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label htmlFor="measurement-datetime">Datum i vreme *</Label>
              <WorkOrderScheduleDateTimePicker
                kind="measurement"
                inputId="measurement-datetime"
                value={measurementDateTime}
                onChange={setMeasurementDateTime}
                disabled={measurementPending || uploadFile.isPending}
                enabled={measurementModalOpen}
                priorScheduleDateYmd={null}
              />
            </div>
            <div className="space-y-2">
              <Label>Tim / radnik *</Label>
              <Select
                value={measurementTeamId}
                onValueChange={setMeasurementTeamId}
                disabled={measurementPending || uploadFile.isPending}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tim/radnika" />
                </SelectTrigger>
                <SelectContent>
                  {(teams ?? [])
                    .filter((t) => t.active)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="measurement-note">Napomena</Label>
              <Textarea
                id="measurement-note"
                value={measurementNote}
                onChange={(e) => setMeasurementNote(e.target.value)}
                disabled={measurementPending || uploadFile.isPending}
                placeholder="Dodatne informacije za tim..."
              />
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Stavke za nalog
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={measurementChecklistDraft}
                  onChange={(e) => setMeasurementChecklistDraft(e.target.value)}
                  disabled={measurementPending || uploadFile.isPending}
                  placeholder="Šta izmeriti / ugraditi (kratko)…"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const t = measurementChecklistDraft.trim();
                    if (!t) return;
                    setMeasurementChecklist((prev) => [...prev, t]);
                    setMeasurementChecklistDraft("");
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  disabled={measurementPending || uploadFile.isPending}
                  onClick={() => {
                    const t = measurementChecklistDraft.trim();
                    if (!t) return;
                    setMeasurementChecklist((prev) => [...prev, t]);
                    setMeasurementChecklistDraft("");
                  }}
                >
                  Dodaj
                </Button>
              </div>
              {measurementChecklist.length > 0 ? (
                <ul className="space-y-1 pt-1">
                  {measurementChecklist.map((text, idx) => (
                    <li
                      key={`${idx}-${text.slice(0, 48)}`}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2 py-2 text-sm"
                    >
                      <span className="leading-snug">{text}</span>
                      <button
                        type="button"
                        disabled={measurementPending || uploadFile.isPending}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                        aria-label="Obriši stavku"
                        onClick={() => setMeasurementChecklist((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground pt-0.5">
                  Lista je opciona; dodajte jasne stavke za ekipu.
                </p>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prilog uz nalog (opciono)
              </Label>
              <Input
                type="file"
                className="cursor-pointer text-sm h-auto py-2"
                disabled={measurementPending || uploadFile.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  setMeasurementAttachmentFile(f ?? null);
                }}
              />
              <LocalFileInlinePreview file={measurementAttachmentFile} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMeasurementModalOpen(false)}
              disabled={measurementPending || uploadFile.isPending}
            >
              Otkaži
            </Button>
            <Button onClick={() => void handleScheduleMeasurement()} disabled={measurementPending || uploadFile.isPending}>
              {measurementPending || uploadFile.isPending ? "Zakazivanje…" : "Sačuvaj i zakaži"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={warrantyModalOpen}
        onOpenChange={(open) => {
          setWarrantyModalOpen(open);
          if (!open) setWarrantyAttachmentFile(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reklamacija ili servis</DialogTitle>
            <DialogDescription>
              Kreira se poseban radni nalog: <strong>reklamacija</strong> ili <strong>servis</strong> (teren — obilazak lokacije, bez
              ugradnje). U nalogu nema obima posla, procene ugradnje niti ponude. Unesite planirani datum obilaska; datum
              garancije posla se ne menja.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="warranty-schedule-date">Planirani datum obilaska *</Label>
              <WorkOrderScheduleDateTimePicker
                kind="installation"
                inputId="warranty-schedule-date"
                value={warrantyScheduledDate}
                onChange={setWarrantyScheduledDate}
                disabled={warrantySubmitting}
                enabled={warrantyModalOpen}
                dateOnly
                displayKind="all"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Tip</Label>
              <RadioGroup
                value={warrantyKind}
                onValueChange={(v) => setWarrantyKind(v as "complaint" | "service")}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="complaint" id="warr-complaint" />
                  <Label htmlFor="warr-complaint" className="font-normal cursor-pointer">
                    Reklamacija
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="service" id="warr-service" />
                  <Label htmlFor="warr-service" className="font-normal cursor-pointer">
                    Servis
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="warranty-notes">Napomena (opciono)</Label>
              <Textarea
                id="warranty-notes"
                value={warrantyNotes}
                onChange={(e) => setWarrantyNotes(e.target.value)}
                placeholder="Kratka napomena za ekipu (npr. pristup, šta reklamirati)…"
                rows={3}
                disabled={warrantySubmitting}
              />
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prilog uz nalog (opciono)
              </Label>
              <Input
                type="file"
                className="cursor-pointer text-sm h-auto py-2"
                disabled={warrantySubmitting || uploadFile.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  setWarrantyAttachmentFile(f ?? null);
                }}
              />
              <LocalFileInlinePreview file={warrantyAttachmentFile} />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setWarrantyModalOpen(false)}
              disabled={warrantySubmitting || uploadFile.isPending}
            >
              Otkaži
            </Button>
            <Button
              type="button"
              onClick={() => void handleWarrantyOrServiceSubmit()}
              disabled={warrantySubmitting || uploadFile.isPending}
            >
              {warrantySubmitting || uploadFile.isPending ? "Čuvanje…" : "Potvrdi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={installationModalOpen}
        onOpenChange={(open) => {
          setInstallationModalOpen(open);
          if (!open) {
            setInstallationAttachmentFile(null);
            setInstallationChecklistDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {job.status === "installation_problem" ? "Ponovo zakazite ugradnju" : "Zakaži ugradnju"}
            </DialogTitle>
            <DialogDescription>
              {job.status === "installation_problem" ? (
                <>
                  Nakon otkaznog terena RN ugradnje biće vraćen u „na čekanju“ sa novim terminom i montažnim timom.
                </>
              ) : (
                <>Upisujete zvaničan termin ugradnje na poslu i dodeljujete montažni tim na nalogu ugradnje.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-2">
              <Label htmlFor="installation-datetime">Datum i vreme ugradnje *</Label>
              <WorkOrderScheduleDateTimePicker
                kind="installation"
                inputId="installation-datetime"
                value={installationDateTime}
                onChange={setInstallationDateTime}
                disabled={installationSchedulePending || uploadFile.isPending}
                enabled={installationModalOpen}
                excludeWorkOrderId={resolveInstallationWorkOrderForSchedule()?.id}
                priorScheduleDateYmd={installationPriorDateYmd}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="installation-team">Montažni tim *</Label>
              <Select
                value={installationTeamId}
                onValueChange={setInstallationTeamId}
                disabled={installationSchedulePending || uploadFile.isPending}
              >
                <SelectTrigger id="installation-team">
                  <SelectValue placeholder="Izaberite montažni tim" />
                </SelectTrigger>
                <SelectContent>
                  {(teams ?? [])
                    .filter((t) => t.active)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="installation-note">Napomena</Label>
              <Textarea
                id="installation-note"
                value={installationNote}
                onChange={(e) => setInstallationNote(e.target.value)}
                disabled={installationSchedulePending || uploadFile.isPending}
                placeholder="Dodatne informacije za montažnu ekipu…"
              />
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Stavke za nalog
              </Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={installationChecklistDraft}
                  onChange={(e) => setInstallationChecklistDraft(e.target.value)}
                  disabled={installationSchedulePending || uploadFile.isPending}
                  placeholder="Šta ugraditi / proveriti na lokaciji (kratko)…"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const t = installationChecklistDraft.trim();
                    if (!t) return;
                    setInstallationChecklist((prev) => [...prev, t]);
                    setInstallationChecklistDraft("");
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  disabled={installationSchedulePending || uploadFile.isPending}
                  onClick={() => {
                    const t = installationChecklistDraft.trim();
                    if (!t) return;
                    setInstallationChecklist((prev) => [...prev, t]);
                    setInstallationChecklistDraft("");
                  }}
                >
                  Dodaj
                </Button>
              </div>
              {installationChecklist.length > 0 ? (
                <ul className="space-y-1 pt-1">
                  {installationChecklist.map((text, idx) => (
                    <li
                      key={`${idx}-${text.slice(0, 48)}`}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2 py-2 text-sm"
                    >
                      <span className="leading-snug">{text}</span>
                      <button
                        type="button"
                        disabled={installationSchedulePending || uploadFile.isPending}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                        aria-label="Obriši stavku"
                        onClick={() => setInstallationChecklist((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground pt-0.5">
                  Lista je opciona; dodajte jasne stavke za montažnu ekipu.
                </p>
              )}
            </div>
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Prilog uz nalog ugradnje (opciono)
              </Label>
              <Input
                type="file"
                className="cursor-pointer text-sm h-auto py-2"
                disabled={installationSchedulePending || uploadFile.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  setInstallationAttachmentFile(f ?? null);
                }}
              />
              <LocalFileInlinePreview file={installationAttachmentFile} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInstallationModalOpen(false)}
              disabled={installationSchedulePending || uploadFile.isPending}
            >
              Otkaži
            </Button>
            <Button
              onClick={() => void handleScheduleInstallation()}
              disabled={installationSchedulePending || uploadFile.isPending}
            >
              {installationSchedulePending || uploadFile.isPending ? "Zakazivanje…" : "Sačuvaj i zakaži"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={fullJobCancelOpen} onOpenChange={setFullJobCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Otkazati ceo posao?</AlertDialogTitle>
            <AlertDialogDescription>
              Status posla će biti „Otkazan“. Automatsko ažuriranje statusa za ovaj posao neće ga menjati dok ručno ne
              promenite pristup. Ova radnja ne briše evidenciju (naloge, izveštaje, ponude).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateJobStatus.isPending}>Nazad</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmCancelEntireJob}
              disabled={updateJobStatus.isPending}
            >
              {updateJobStatus.isPending ? "Čuvanje…" : "Da, otkazati posao"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
