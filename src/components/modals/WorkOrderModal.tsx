import { useState, useEffect, useMemo } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { WorkOrder, WorkOrderType, type WorkOrderCreateInput, type UserRole, type WorkOrderItem } from "@/types";
import { useTeams } from "@/hooks/use-teams";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  MapPin,
  ExternalLink,
  ClipboardList,
  Trash2,
  Calendar,
  Users,
  Info,
  Check,
  ChevronsUpDown,
  Phone,
  Mail,
  Clock,
  Hash,
  Package,
  Link as LinkIcon,
  Paperclip,
  ChevronDown,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { sr } from "date-fns/locale";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
} from "@/lib/job-status-lifecycle";
import {
  formatJobInstallationLocationDisplay,
  jobInstallationStreetAddress,
} from "@/lib/job-installation-location";
import { labelJobStatus, labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import {
  MANUAL_WORK_ORDER_TYPE_OPTIONS,
  MANUAL_WORK_ORDER_TYPE_VALUES,
} from "@/lib/manual-work-order-type-options";
import { isProductionWorkOrderPhaseDeferred } from "@/lib/production-workflow-phase";
import { Badge } from "@/components/ui/badge";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { WorkOrderTypeBadge } from "@/components/work-order/WorkOrderTypeBadge";
import { OpenInGoogleMapsButton } from "@/components/shared/OpenInGoogleMapsButton";
import { Separator } from "@/components/ui/separator";
import { isLightweightFieldVisitWorkOrderType, workOrderTypeDetailHint } from "@/lib/work-order-detail-hints";
import { cn } from "@/lib/utils";
import { AddressMiniMap } from "@/components/shared/AddressMiniMap";
import { ProductionMaterialTab } from "@/components/job-tabs/ProductionMaterialTab";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleWorkOrderItem, updateWorkOrderItemMeasurements } from "@/actions/work-order-items";
import {
  canToggleWorkOrderChecklist,
  isFieldExecutionRole,
  MONTAZA_WORK_ORDER_TYPES,
  TEREN_WORK_ORDER_TYPES,
} from "@/lib/field-team-access";
import { WoItemMeasurementsField } from "@/components/work-order/WoItemMeasurementsField";
import { formatWorkOrderDescriptionForWorker } from "@/lib/work-order-description-display";
import {
  LocalFileInlinePreview,
  StoredFileInlinePreview,
} from "@/components/work-order/FileAttachmentInlinePreview";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useFiles } from "@/hooks/use-files";
import { openStoredFileById } from "@/lib/stored-file-access";
import { formatScheduledDateTimeDisplay, formatWorkOrderScheduleDisplay } from "@/lib/schedule-datetime-display";
import {
  normalizeWorkOrderScheduleFormValue,
  workOrderScheduledDatetimeForDb,
} from "@/lib/work-order-schedule-calendar";
import { WorkOrderScheduleDateTimePicker } from "@/components/work-order/WorkOrderScheduleDateTimePicker";

/** Vrednost u Select-u za RN bez tima (mapira se na null u bazi). */
const WORK_ORDER_UNASSIGNED_TEAM = "__work_order_unassigned__";

/** Red iz Supabase: `customers (embed)` nije uvek izabran kada upit ima fallback bez join-a. */
type JobModalQueryRow = {
  id: string;
  job_number: string;
  status?: string;
  summary?: string | null;
  installation_address?: string | null;
  installation_apartment?: string | null;
  installation_floor?: string | null;
  customer_phone?: string | null;
  estimated_installation_hours?: unknown;
  scheduled_date?: string | null;
  customers?: unknown;
};

interface WorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (order: WorkOrderCreateInput | WorkOrder) => void | Promise<void>;
  onStartOrder?: (order: WorkOrder) => void;
  canStartFromDetails?: boolean;
  startDisabled?: boolean;
  startDisabledReason?: string;
  /** Iz detalja: otvara terenski/proizvodni izveštaj (nalog mora biti „U toku“). */
  onFinishOrder?: (order: WorkOrder) => void;
  canFinishFromDetails?: boolean;
  finishDisabled?: boolean;
  finishDisabledReason?: string;
  jobId?: string;
  order?: WorkOrder;
  readOnly?: boolean;
}

const nonCompletedJobStatuses = [
  "new",
  "quote_sent",
  "final_quote_sent",
  "final_quote_accepted_pending_payment",
  "accepted",
  "measuring",
  "measurement_processing",
  "ready_for_work",
  "waiting_material",
  "partial_in_production",
  "in_production",
  "scheduled",
  "installation_in_progress",
  "installation_done_unpaid",
  "complaint",
  "service",
  "canceled",
] as const;

export function WorkOrderModal({
  isOpen,
  onClose,
  onSave,
  onStartOrder,
  canStartFromDetails = false,
  startDisabled = false,
  startDisabledReason,
  onFinishOrder,
  canFinishFromDetails = false,
  finishDisabled = false,
  finishDisabledReason,
  jobId,
  order,
  readOnly = false,
}: WorkOrderModalProps) {
  const queryClient = useQueryClient();
  const { teams } = useTeams();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [checklistDraft, setChecklistDraft] = useState("");
  const [pendingChecklist, setPendingChecklist] = useState<string[]>([]);
  const [jobSelectOpen, setJobSelectOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const orderWithJob = order as
    | (WorkOrder & {
        job?: {
          id: string;
          jobNumber: string;
          installationAddress?: string;
          customerPhone?: string | null;
          customer?: { fullName: string; phones?: string[] };
        };
        assignedTeamName?: string;
      })
    | undefined;

  const [formData, setFormData] = useState<Omit<WorkOrder, "id"> | WorkOrder>({
    jobId: jobId || "",
    type: "measurement",
    description: "",
    assignedTeamId: "",
    date: new Date().toISOString().split("T")[0],
    status: "pending",
    attachmentFileId: undefined,
    attachmentName: "",
    installationRef: "",
    productionRef: "",
  });

  const [pendingAttachmentFile, setPendingAttachmentFile] = useState<File | null>(null);
  const [attachmentClear, setAttachmentClear] = useState(false);
  /** Kolaps u bloku „Pregled posla“. */
  const [jobSummaryAttachmentOpen, setJobSummaryAttachmentOpen] = useState(false);
  /** Kolaps za izbor fajla (forma). */
  const [attachmentEditorOpen, setAttachmentEditorOpen] = useState(false);
  const [woSavePending, setWoSavePending] = useState(false);
  const { uploadFile, deleteFile } = useFiles();

  const effectiveJobId = (orderWithJob?.jobId || jobId || formData.jobId || "").trim();

  const { data: jobDetails, isLoading: jobDetailsLoading, isError: jobDetailsError } = useQuery({
    queryKey: ["job-details-for-modal", effectiveJobId],
    queryFn: async () => {
      if (!effectiveJobId) return null;
      const preferred = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, summary, installation_address, installation_apartment, installation_floor, billing_address, customer_phone, estimated_installation_hours, scheduled_date, customers (name, phones, emails, contact_person, installation_address, billing_address)",
        )
        .eq("id", effectiveJobId)
        .single();
      if (!preferred.error) return preferred.data;
      const mid = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, summary, installation_address, installation_apartment, installation_floor, customer_phone, estimated_installation_hours, scheduled_date, customers (name, phones, emails, contact_person)",
        )
        .eq("id", effectiveJobId)
        .single();
      if (!mid.error) return mid.data;
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, installation_address, installation_apartment, installation_floor, estimated_installation_hours, scheduled_date")
        .eq("id", effectiveJobId)
        .single();
      if (fallback.error) throw fallback.error;
      return fallback.data;
    },
    enabled: isOpen && effectiveJobId.length > 0,
  });

  const displayJob = jobDetails
    ? (() => {
        const j = jobDetails as JobModalQueryRow;
        return {
          id: j.id as string,
          jobNumber: j.job_number as string,
          installationAddress: j.installation_address as string | undefined,
          installationApartment:
            typeof j.installation_apartment === "string" ? j.installation_apartment : undefined,
          installationFloor: typeof j.installation_floor === "string" ? j.installation_floor : undefined,
          customerPhone: j.customer_phone as string | null | undefined,
          estimatedInstallationHours: (() => {
            const raw = j.estimated_installation_hours;
            if (raw === null || raw === undefined) return undefined;
            const n = typeof raw === "number" ? raw : Number(raw);
            return Number.isFinite(n) ? n : undefined;
          })(),
          jobStatus: j.status,
          summary: j.summary,
          customerName: Array.isArray(j.customers)
            ? String(
                (j.customers[0] as { name?: string } | undefined)?.name ??
                  (j.customers[0] as { full_name?: string } | undefined)?.full_name ??
                  "",
              )
            : String(
                (j.customers as { name?: string } | null | undefined)?.name ??
                  (j.customers as { full_name?: string } | null | undefined)?.full_name ??
                  "",
              ),
          contactPerson: Array.isArray(j.customers)
            ? String((j.customers[0] as { contact_person?: string } | undefined)?.contact_person ?? "")
            : String((j.customers as { contact_person?: string } | null | undefined)?.contact_person ?? ""),
          customerInstallation: Array.isArray(j.customers)
            ? String((j.customers[0] as { installation_address?: string } | undefined)?.installation_address ?? "")
            : String(
                (j.customers as { installation_address?: string } | null | undefined)?.installation_address ?? "",
              ),
          customerPhones: (Array.isArray(j.customers)
            ? (j.customers[0] as { phones?: string[] } | undefined)?.phones
            : (j.customers as { phones?: string[] } | null | undefined)?.phones) as string[] | undefined,
          customerEmails: (Array.isArray(j.customers)
            ? (j.customers[0] as { emails?: string[] } | undefined)?.emails
            : (j.customers as { emails?: string[] } | null | undefined)?.emails) as string[] | undefined,
        };
      })()
    : orderWithJob?.job
      ? {
          id: orderWithJob.job.id,
          jobNumber: orderWithJob.job.jobNumber,
          installationAddress: orderWithJob.job.installationAddress,
          customerPhone: orderWithJob.job.customerPhone ?? null,
          customerPhones: orderWithJob.job.customer?.phones ?? [],
          customerName: orderWithJob.job.customer?.fullName,
        }
      : null;

  const { data: jobs } = useQuery({
    queryKey: ["jobs-list-minimal"],
    queryFn: async () => {
      const preferred = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, installation_address, customer_phone, summary, customers (name, phones, emails, contact_person, installation_address)",
        )
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (!preferred.error) return preferred.data ?? [];
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, status, installation_address, customer_phone")
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      return fallback.data ?? [];
    },
    enabled: isOpen && !jobId && !readOnly,
  });

  useEffect(() => {
    if (order) {
      const scheduleUsesDateTime =
        order.type === "measurement" ||
        order.type === "measurement_verification" ||
        order.type === "installation";
      setFormData({
        ...order,
        date: normalizeWorkOrderScheduleFormValue(order.date, { dateOnly: !scheduleUsesDateTime }),
        assignedTeamId: order.assignedTeamId ?? WORK_ORDER_UNASSIGNED_TEAM,
        measurementLocation: "",
        measurementScope: "",
      });
    } else {
      const defaultTeamId =
        user?.teamId && teams?.some((t) => t.id === user.teamId && t.active)
          ? user.teamId
          : "";
      setFormData({
        jobId: jobId || "",
        type: "measurement",
        description: "",
        assignedTeamId: defaultTeamId,
        date: new Date().toISOString().split("T")[0],
        status: "pending",
        attachmentFileId: undefined,
        attachmentName: "",
        installationRef: "",
        productionRef: ""
      });
      setPendingChecklist([]);
      setChecklistDraft("");
    }
    setPendingAttachmentFile(null);
    setAttachmentClear(false);
    setJobSummaryAttachmentOpen(false);
    setAttachmentEditorOpen(false);
  }, [order, isOpen, jobId, user?.teamId, teams]);

  useEffect(() => {
    if (!isOpen) {
      setJobSearch("");
      setJobSelectOpen(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!formData.jobId) {
      toast({
        title: "Nedostaje posao",
        description: "Izaberite posao za koji kreirate radni nalog.",
        variant: "destructive",
      });
      return;
    }
    const resolvedTeamId =
      !formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM
        ? undefined
        : formData.assignedTeamId;
    if (!resolvedTeamId && !order) {
      toast({
        title: "Nedostaje tim",
        description: "Dodelite radni nalog timu pre čuvanja.",
        variant: "destructive",
      });
      return;
    }
    if (pendingAttachmentFile && !user?.id) {
      toast({
        title: "Prijava je potrebna",
        description: "Morate biti ulogovani da otpremite prilog.",
        variant: "destructive",
      });
      return;
    }

    const measurementFields = { measurementLocation: "", measurementScope: "" };
    const jobForUpload = effectiveJobId.trim();

    let nextAttachmentFileId = formData.attachmentFileId;
    let nextAttachmentName = formData.attachmentName;
    let oldAttachmentFileIdToDelete: string | undefined;

    try {
      setWoSavePending(true);

      if (pendingAttachmentFile && user?.id) {
        const uploaded = await uploadFile.mutateAsync({
          jobId: jobForUpload,
          category: "work_order",
          file: pendingAttachmentFile,
          uploadedBy: user.id,
        });
        nextAttachmentFileId = uploaded.id;
        nextAttachmentName = uploaded.name;
        if (order?.attachmentFileId && order.attachmentFileId !== uploaded.id) {
          oldAttachmentFileIdToDelete = order.attachmentFileId;
        }
      } else if (attachmentClear && order?.attachmentFileId) {
        nextAttachmentFileId = undefined;
        nextAttachmentName = undefined;
        oldAttachmentFileIdToDelete = order.attachmentFileId;
      }

      if (order) {
        await onSave({
          ...(formData as WorkOrder),
          ...measurementFields,
          assignedTeamId: resolvedTeamId,
          attachmentFileId: nextAttachmentFileId,
          attachmentName: nextAttachmentName,
          date: workOrderScheduledDatetimeForDb(formData.date) ?? formData.date,
        } as WorkOrder);
      } else {
        const trimmedLines = pendingChecklist.map((l) => l.trim()).filter((l) => l.length > 0);
        const createPayload: WorkOrderCreateInput = {
          ...formData,
          ...measurementFields,
          assignedTeamId: resolvedTeamId,
          attachmentFileId: nextAttachmentFileId,
          attachmentName: nextAttachmentName,
          date: workOrderScheduledDatetimeForDb(formData.date) ?? formData.date,
          ...(trimmedLines.length > 0 ? { checklistItems: trimmedLines } : {}),
        };
        await onSave(createPayload);
      }

      if (oldAttachmentFileIdToDelete) {
        await deleteFile.mutateAsync(oldAttachmentFileIdToDelete);
      }

      onClose();
    } catch (err) {
      toast({
        title: "Čuvanje nije uspelo",
        description: err instanceof Error ? err.message : "Pokušajte ponovo.",
        variant: "destructive",
      });
    } finally {
      setWoSavePending(false);
    }
  };

  const selectedTeam = teams?.find(
    (t) =>
      t.id === formData.assignedTeamId &&
      formData.assignedTeamId !== WORK_ORDER_UNASSIGNED_TEAM,
  );
  const selectableJobs = (jobs ?? []) as JobModalQueryRow[];
  const filteredJobs = selectableJobs.filter((j) => {
    const customerName = Array.isArray(j.customers)
      ? ((j.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
        (j.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
        "")
      : ((j.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
        (j.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
        "");
    const q = jobSearch.trim().toLowerCase();
    if (!q) return true;
    return j.job_number.toLowerCase().includes(q) || customerName.toLowerCase().includes(q);
  });
  const selectedJob = selectableJobs.find((j) => j.id === formData.jobId);
  const formOrderWithId = "id" in formData ? (formData as WorkOrder) : null;

  const jobSummaryPhone = displayJob
    ? jobPrimaryPhone({
        customerPhone:
          "customerPhone" in displayJob && displayJob.customerPhone != null
            ? String(displayJob.customerPhone)
            : null,
        customer: {
          phones:
            "customerPhones" in displayJob && Array.isArray(displayJob.customerPhones)
              ? displayJob.customerPhones
              : [],
        },
      })
    : "";

  const jobSummaryEmail =
    displayJob &&
    "customerEmails" in displayJob &&
    Array.isArray((displayJob as { customerEmails?: string[] }).customerEmails)
      ? (displayJob as { customerEmails: string[] }).customerEmails.find((e) => typeof e === "string" && e.trim()) ?? ""
      : "";

  const isMeasurementOrInstallationWo =
    formData.type === INSTALLATION_WORK_ORDER_TYPE ||
    MEASUREMENT_WORK_ORDER_TYPES.includes(formData.type);
  const lightweightFieldVisit = isLightweightFieldVisitWorkOrderType(formData.type);
  const isProductionOrder = formData.type === "production";

  const workInstallationStreet =
    jobInstallationStreetAddress({
      installationAddress:
        displayJob?.installationAddress ||
        (displayJob && "customerInstallation" in displayJob
          ? (displayJob as { customerInstallation?: string }).customerInstallation
          : ""),
    }) || "";

  const workInstallationLocationLabel = isMeasurementOrInstallationWo
    ? formatJobInstallationLocationDisplay({
        installationAddress: displayJob?.installationAddress,
        installationApartment:
          displayJob && "installationApartment" in displayJob
            ? (displayJob as { installationApartment?: string }).installationApartment
            : undefined,
        installationFloor:
          displayJob && "installationFloor" in displayJob
            ? (displayJob as { installationFloor?: string }).installationFloor
            : undefined,
      })
    : workInstallationStreet;

  const showWorkInstallLocation =
    !isProductionOrder &&
    (isMeasurementOrInstallationWo
      ? !!workInstallationLocationLabel.trim()
      : !!workInstallationStreet.trim());

  const woStatusVariant: Record<WorkOrder["status"], "success" | "warning" | "info" | "muted"> = {
    completed: "success",
    in_progress: "info",
    pending: "warning",
    canceled: "muted",
  };

  const formatWoDate = (d: string) => {
    try {
      return format(parseISO(d), "d. MMMM yyyy.", { locale: sr });
    } catch {
      return d;
    }
  };
  const formatWoDateTime = (d: string) => {
    try {
      return format(parseISO(d), "d. MMMM yyyy. HH:mm", { locale: sr });
    } catch {
      return d;
    }
  };

  const readOnlyTeamLabel =
    orderWithJob?.assignedTeamName ||
    selectedTeam?.name ||
    (!formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM
      ? "Neraspoređeno (čeka dodelu tima)"
      : "—");

  const schedulePickerKind =
    formData.type === "measurement" || formData.type === "measurement_verification"
      ? "measurement"
      : "installation";

  const manualTypeSelectRows = useMemo(() => {
    let opts = MANUAL_WORK_ORDER_TYPE_OPTIONS.filter(
      (o) => !(isProductionWorkOrderPhaseDeferred() && o.value === "production"),
    );
    if (order?.type === "production" && isProductionWorkOrderPhaseDeferred()) {
      opts = [...opts, { value: "production" as const, label: labelWorkOrderType("production") }];
    }
    if (order && !MANUAL_WORK_ORDER_TYPE_VALUES.has(formData.type)) {
      return [...opts, { value: formData.type, label: labelWorkOrderType(formData.type) }];
    }
    return opts;
  }, [order, formData.type]);

  const workOrderPkReadonly = order?.id;
  const { data: workOrderDbItems, isLoading: workOrderDbItemsLoading } = useQuery({
    queryKey: ["work-order-items", workOrderPkReadonly],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_items")
        .select("id, work_order_id, description, is_completed, measurements")
        .eq("work_order_id", workOrderPkReadonly!)
        .order("id", { ascending: true });
      if (error) throw error;
      return (
        Array.isArray(data)
          ? data.map((row) => ({
              id: row.id as string,
              workOrderId: row.work_order_id as string,
              description: typeof row.description === "string" ? row.description : "",
              isCompleted: row.is_completed === true,
              measurements:
                typeof (row as { measurements?: unknown }).measurements === "string"
                  ? ((row as { measurements: string }).measurements ?? "")
                  : "",
            }))
          : []
      );
    },
    enabled: !!(readOnly && isOpen && workOrderPkReadonly),
  });

  const [toggleItemPendingId, setToggleItemPendingId] = useState<string | null>(null);
  const toggleItemMutation = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      toggleWorkOrderItem(itemId, completed),
    onMutate: (v) => {
      setToggleItemPendingId(v.itemId);
    },
    onSettled: () => {
      setToggleItemPendingId(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["work-order-items", workOrderPkReadonly],
      });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: error instanceof Error ? error.message : "Ažuriranje stavke nije uspelo.",
        variant: "destructive",
      });
    },
  });

  /** Teren / montaža / proizvodnja: stavke se ne popunjavaju u detaljima naloga, već u izveštaju nakon pokretanja. */
  const canToggleChecklistInDetails =
    readOnly &&
    !!order &&
    canToggleWorkOrderChecklist(order, user?.role, user?.teamId ?? undefined) &&
    !isFieldExecutionRole(user?.role);

  const measurementsForMeasurementWoOnly =
    order &&
    canToggleChecklistInDetails &&
    (order.type === "measurement" || order.type === "measurement_verification");

  const saveItemMeasuresMutation = useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) =>
      updateWorkOrderItemMeasurements(itemId, text),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["work-order-items", workOrderPkReadonly],
      });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: error instanceof Error ? error.message : "Čuvanje mera nije uspelo.",
        variant: "destructive",
      });
    },
  });

  const addPendingChecklistLine = () => {
    const trimmed = checklistDraft.trim();
    if (!trimmed) return;
    setPendingChecklist((prev) => [...prev, trimmed]);
    setChecklistDraft("");
  };
  const scheduleDateLabel =
    formData.type === "measurement" || formData.type === "measurement_verification"
      ? "Zakazan datum merenja"
      : lightweightFieldVisit
        ? "Planirani datum obilaska"
        : isProductionOrder
          ? "Planirani datum proizvodnje"
          : "Zakazan datum ugradnje";

  const jobScheduledRaw =
    jobDetails && typeof (jobDetails as JobModalQueryRow).scheduled_date === "string"
      ? (jobDetails as JobModalQueryRow).scheduled_date
      : null;

  const scheduleDateDisplay = useMemo(() => {
    if (formData.type === "installation" && jobScheduledRaw) {
      const fromJob = formatScheduledDateTimeDisplay(jobScheduledRaw);
      if (fromJob) return fromJob;
    }
    return (
      formatWorkOrderScheduleDisplay({
        date: formData.date,
        description: formData.description,
        type: formData.type,
        jobScheduledAt: jobScheduledRaw,
      }) ?? formatWoDate(formData.date)
    );
  }, [formData.type, formData.date, formData.description, jobScheduledRaw]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          "w-full max-h-[90vh] overflow-y-auto",
          readOnly ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "Detalji radnog naloga" : (order ? "Izmeni radni nalog" : "Dodaj novi radni nalog")}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Tip, tim, datum, opis zadatka, posao, ponuda i lokacija — sve na jednom mestu."
              : "Unesite detalje o radnom nalogu. Sva polja sa zvezdicom su obavezna."}
          </DialogDescription>
        </DialogHeader>

        {readOnly ? (
          <div className="space-y-5 py-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1 min-w-0">
                {!isFieldExecutionRole(user?.role) ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Tip naloga
                    </p>
                    <WorkOrderTypeBadge type={formData.type} size="lg" />
                  </>
                ) : null}
                {displayJob?.id ? (
                  <Link
                    to={`/jobs/${displayJob.id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                    Posao {displayJob.jobNumber}
                  </Link>
                ) : displayJob?.jobNumber ? (
                  <p className="text-sm text-muted-foreground">Posao {displayJob.jobNumber}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <GenericBadge label={labelWorkOrderStatus(formData.status)} variant={woStatusVariant[formData.status]} />
                {(!formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM) && (
                  <GenericBadge label="Neraspoređeno" variant="warning" />
                )}
              </div>
            </div>

            {!isFieldExecutionRole(user?.role) ? (
              <p className="text-sm text-muted-foreground leading-relaxed border-l-[3px] border-primary/35 pl-3 py-2 rounded-r-md bg-muted/50">
                {workOrderTypeDetailHint(formData.type)}
              </p>
            ) : null}

            {formData.type === "installation" &&
            displayJob &&
            "estimatedInstallationHours" in displayJob &&
            typeof (displayJob as { estimatedInstallationHours?: number }).estimatedInstallationHours === "number" ? (
              <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">Procena trajanja ugradnje</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {(displayJob as { estimatedInstallationHours: number }).estimatedInstallationHours} h
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Uneta pri merenju i vezana za posao; koristi montaža pri pripremi ugradnje.
                  </p>
                </div>
              </div>
            ) : null}

            {!lightweightFieldVisit &&
            !isProductionOrder &&
            formData.type !== "installation" &&
            formData.type !== "measurement" &&
            formData.type !== "measurement_verification" &&
            displayJob &&
            "estimatedInstallationHours" in displayJob &&
            typeof (displayJob as { estimatedInstallationHours?: number }).estimatedInstallationHours === "number" ? (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
                <Clock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Planirana procena ugradnje (posao)</p>
                  <p className="text-base font-semibold tabular-nums">
                    {(displayJob as { estimatedInstallationHours: number }).estimatedInstallationHours} h
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Pomaže planiranju; ugradnja ima poseban radni nalog kada dođe na red.
                  </p>
                </div>
              </div>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Opis zadatka
              </h3>
              <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {(() => {
                  const raw = formData.description?.trim();
                  if (!raw) return "—";
                  if (readOnly && isFieldExecutionRole(user?.role)) {
                    return formatWorkOrderDescriptionForWorker(raw, formData.type);
                  }
                  return raw;
                })()}
              </div>
            </section>

            {formData.attachmentFileId ? (
              <Collapsible defaultOpen={false} className="rounded-xl border border-border bg-muted/20">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40 rounded-t-xl">
                  <span className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">Prilog uz nalog</span>
                    {formData.attachmentName ? (
                      <span className="text-xs font-normal text-muted-foreground truncate">· {formData.attachmentName}</span>
                    ) : null}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="px-4 pb-4 pt-0 space-y-3">
                  <p className="text-xs text-muted-foreground leading-snug">
                    Dokument koji je kancelarija dodala uz nalog. Za PDF i slike prikazuje se pregled ispod; ostale
                    tipove otvorite u novom tabu.
                  </p>
                  <StoredFileInlinePreview fileId={formData.attachmentFileId} enabled={readOnly && isOpen} />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    onClick={async () => {
                      if (!formData.attachmentFileId) return;
                      const r = await openStoredFileById(formData.attachmentFileId);
                      if ("message" in r) {
                        toast({
                          title: "Otvaranje fajla",
                          description: r.message,
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Otvori prilog
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {(formData.productionRef?.trim() || formData.installationRef?.trim()) && (
              <section className="grid gap-3 sm:grid-cols-2">
                {formData.productionRef?.trim() ? (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> Referenca proizvodnje
                    </p>
                    <p className="text-sm font-medium">{formData.productionRef}</p>
                  </div>
                ) : null}
                {formData.installationRef?.trim() ? (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Referenca ugradnje
                    </p>
                    <p className="text-sm font-medium">{formData.installationRef}</p>
                  </div>
                ) : null}
              </section>
            )}

            <section className="grid gap-4 sm:grid-cols-2 rounded-xl border border-border bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Dodeljen tim
                </p>
                <p className="text-sm font-medium text-foreground">{readOnlyTeamLabel}</p>
              </div>
              <div className="space-y-1 sm:text-right">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground sm:text-right flex items-center gap-1.5 sm:justify-end">
                  <Calendar className="w-3.5 h-3.5" /> {scheduleDateLabel}
                </p>
                <p className="text-sm font-medium text-foreground">{scheduleDateDisplay}</p>
              </div>
              {!isFieldExecutionRole(user?.role) ? (
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Datum kreiranja naloga
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {formData.createdAt ? formatWoDateTime(formData.createdAt) : "—"}
                  </p>
                </div>
              ) : null}
            </section>

            {displayJob && !isProductionOrder && (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posao i klijent</h3>
                  <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
                    <p className="text-base font-semibold">
                      {displayJob.jobNumber} — {displayJob.customerName || "Kupac"}
                    </p>
                    {"jobStatus" in displayJob && displayJob.jobStatus ? (
                      <p className="text-sm text-muted-foreground">
                        Status posla:{" "}
                        <span className="text-foreground font-medium">{labelJobStatus(displayJob.jobStatus)}</span>
                      </p>
                    ) : null}
                    {"contactPerson" in displayJob && (displayJob as { contactPerson?: string }).contactPerson?.trim() ? (
                      <p className="text-sm text-muted-foreground">
                        Kontakt osoba:{" "}
                        <span className="text-foreground font-medium">
                          {(displayJob as { contactPerson: string }).contactPerson}
                        </span>
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {jobSummaryPhone ? (
                        <a href={`tel:${jobSummaryPhone}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                          <Phone className="h-4 w-4 shrink-0" /> {jobSummaryPhone}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Telefon: nije unet na poslu / klijentu.</p>
                      )}
                      {jobSummaryEmail && !isFieldExecutionRole(user?.role) ? (
                        <a
                          href={`mailto:${jobSummaryEmail}`}
                          className="inline-flex items-center gap-2 text-sm font-medium text-primary break-all"
                        >
                          <Mail className="h-4 w-4 shrink-0" /> {jobSummaryEmail}
                        </a>
                      ) : null}
                    </div>
                    {!lightweightFieldVisit &&
                    "summary" in displayJob &&
                    (displayJob as { summary?: string }).summary?.trim() ? (
                      <div className="space-y-1 pt-1">
                        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Sažetak posla</p>
                        <p className="text-sm leading-relaxed text-foreground rounded-lg border border-border bg-muted/40 p-3">
                          {(displayJob as { summary: string }).summary}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </section>
              </>
            )}

            {workOrderDbItemsLoading && workOrderPkReadonly ? (
              <p className="text-xs text-muted-foreground">Učitavanje stavki za nalog…</p>
            ) : null}

            {!workOrderDbItemsLoading &&
            workOrderDbItems &&
            workOrderDbItems.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Stavke za nalog
                </h3>
                <ul className="rounded-xl border border-border divide-y divide-border bg-card">
                  {workOrderDbItems.map((row) => (
                    <li key={row.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                      <div className="flex gap-3 items-start">
                        <Checkbox
                          id={`wo-item-${row.id}`}
                          className="mt-0.5"
                          checked={row.isCompleted}
                          disabled={
                            !canToggleChecklistInDetails ||
                            (toggleItemMutation.isPending && toggleItemPendingId === row.id)
                          }
                          onCheckedChange={(c) =>
                            toggleItemMutation.mutate({
                              itemId: row.id,
                              completed: c === true,
                            })
                          }
                        />
                        <Label
                          htmlFor={`wo-item-${row.id}`}
                          className={cn(
                            "leading-snug cursor-pointer flex-1 min-w-0",
                            !canToggleChecklistInDetails && "cursor-default",
                          )}
                        >
                          <span className={row.isCompleted ? "line-through text-muted-foreground" : "text-foreground"}>
                            {row.description.trim() ? row.description : "—"}
                          </span>
                        </Label>
                      </div>
                      {measurementsForMeasurementWoOnly ? (
                        <WoItemMeasurementsField
                          row={{ id: row.id, measurements: row.measurements }}
                          disabledSaving={!canToggleChecklistInDetails}
                          isSaving={
                            saveItemMeasuresMutation.isPending &&
                            saveItemMeasuresMutation.variables?.itemId === row.id
                          }
                          onSave={(itemId, text) =>
                            saveItemMeasuresMutation.mutate({ itemId, text })
                          }
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
                {readOnly &&
                order &&
                isFieldExecutionRole(user?.role) &&
                canToggleWorkOrderChecklist(order, user?.role, user?.teamId ?? undefined) ? (
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {order.type === "installation"
                      ? "Stavke ugradnje označavajte u montažnom izveštaju"
                      : "Stavke ček liste i mere unosite u terenskom izveštaju"}{" "}
                    nakon što pokrenete nalog (status „U toku“), ne ovde u detaljima.
                  </p>
                ) : null}
              </section>
            ) : null}

            {showWorkInstallLocation ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  Adresa
                </h3>
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium text-foreground leading-snug">{workInstallationLocationLabel}</p>
                  {workInstallationStreet ? (
                    <AddressMiniMap
                      address={workInstallationStreet}
                      className="mt-0 h-36 sm:h-40 rounded-lg border border-border/80 bg-background shadow-sm [&_.leaflet-container]:rounded-lg"
                    />
                  ) : null}
                  <OpenInGoogleMapsButton
                    address={workInstallationStreet}
                    className="w-full sm:w-auto border-primary/30"
                  />
                </div>
              </section>
            ) : null}

            {formData.type === "production" && effectiveJobId ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Proizvodnja i skeniranje bar kodova
                  </h3>
                  <ProductionMaterialTab jobId={effectiveJobId} mode="production" />
                </section>
              </>
            ) : null}

            <DialogFooter className="pt-2 flex flex-wrap gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose} className="w-full sm:w-auto">
                Zatvori
              </Button>
              {canStartFromDetails && formOrderWithId?.id ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={startDisabled}
                  title={startDisabled ? startDisabledReason : "Pokreni radni nalog"}
                  onClick={() => {
                    if (formOrderWithId?.id && onStartOrder) {
                      onStartOrder(formOrderWithId);
                    }
                  }}
                >
                  Pokreni
                </Button>
              ) : null}
              {canFinishFromDetails && formOrderWithId?.id ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={finishDisabled}
                  title={finishDisabled ? finishDisabledReason : undefined}
                  onClick={() => {
                    if (formOrderWithId?.id && onFinishOrder) {
                      onFinishOrder(formOrderWithId);
                    }
                  }}
                >
                  {formOrderWithId.type === "production" ? "Popuni izveštaj" : "Završi"}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {!jobId && !order && (
              <div className="grid gap-2">
                <Label htmlFor="jobId">Posao *</Label>
                <Popover open={jobSelectOpen} onOpenChange={setJobSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={jobSelectOpen} className="justify-between">
                      {selectedJob
                        ? `${selectedJob.job_number} — ${
                            Array.isArray(selectedJob.customers)
                              ? ((selectedJob.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
                                (selectedJob.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
                                "Kupac")
                              : ((selectedJob.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
                                (selectedJob.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
                                "Kupac")
                          }`
                        : "Izaberite posao"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width]">
                    <Command>
                      <CommandInput placeholder="Pretraži posao ili kupca..." value={jobSearch} onValueChange={setJobSearch} />
                      <CommandList>
                        <CommandEmpty>Nema rezultata.</CommandEmpty>
                        <CommandGroup>
                          {filteredJobs.map((j) => {
                            const customerName = Array.isArray(j.customers)
                              ? ((j.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
                                (j.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
                                "Kupac")
                              : ((j.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
                                (j.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
                                "Kupac");
                            const cust0 = Array.isArray(j.customers)
                              ? (j.customers[0] as { phones?: string[] } | undefined)
                              : (j.customers as { phones?: string[] } | null | undefined);
                            const rowPhone = jobPrimaryPhone({
                              customerPhone: (j as { customer_phone?: string | null }).customer_phone ?? null,
                              customer: { phones: cust0?.phones ?? [] },
                            });
                            return (
                              <CommandItem
                                key={j.id}
                                value={`${j.job_number} ${customerName} ${rowPhone}`}
                                onSelect={() => {
                                  setFormData({ ...formData, jobId: j.id });
                                  setJobSelectOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.jobId === j.id ? "opacity-100" : "opacity-0"}`} />
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span>
                                    {j.job_number} — {customerName}
                                  </span>
                                  {rowPhone ? (
                                    <span className="text-[11px] text-muted-foreground truncate">{rowPhone}</span>
                                  ) : null}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            {effectiveJobId ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pregled posla</p>
                {jobDetailsLoading ? (
                  <p className="text-xs text-muted-foreground">Učitavanje podataka o poslu…</p>
                ) : jobDetailsError ? (
                  <p className="text-xs text-destructive">Nije moguće učitati podatke o poslu. Proverite dozvolu ili vezu.</p>
                ) : displayJob ? (
                  <>
                    <div className="font-medium leading-snug">
                      {displayJob.jobNumber} — {displayJob.customerName || "Kupac"}
                    </div>
                    {"jobStatus" in displayJob && displayJob.jobStatus ? (
                      <p className="text-xs text-muted-foreground">
                        Status posla:{" "}
                        <span className="text-foreground font-medium">{labelJobStatus(displayJob.jobStatus)}</span>
                      </p>
                    ) : null}
                    {!isProductionOrder &&
                    "contactPerson" in displayJob &&
                    (displayJob as { contactPerson?: string }).contactPerson?.trim() ? (
                      <p className="text-xs text-muted-foreground">
                        Kontakt:{" "}
                        <span className="text-foreground">{(displayJob as { contactPerson: string }).contactPerson}</span>
                      </p>
                    ) : null}
                    {!isProductionOrder && jobSummaryPhone ? (
                      <a
                        href={`tel:${jobSummaryPhone}`}
                        className="flex items-center gap-1.5 text-xs text-primary font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3 w-3 shrink-0" /> {jobSummaryPhone}
                      </a>
                    ) : !isProductionOrder ? (
                      <p className="text-xs text-muted-foreground">Telefon: nije unet na poslu / klijentu.</p>
                    ) : null}
                    {!isProductionOrder && jobSummaryEmail && !isFieldExecutionRole(user?.role) ? (
                      <a
                        href={`mailto:${jobSummaryEmail}`}
                        className="flex items-center gap-1.5 text-xs text-primary font-medium break-all"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Mail className="h-3 w-3 shrink-0" /> {jobSummaryEmail}
                      </a>
                    ) : null}
                    {showWorkInstallLocation ? (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="text-foreground">{workInstallationLocationLabel}</span>
                      </div>
                    ) : null}
                    {!lightweightFieldVisit &&
                    !isProductionOrder &&
                    "summary" in displayJob &&
                    (displayJob as { summary?: string }).summary?.trim() ? (
                      <div className="space-y-0.5 pt-0.5">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Sažetak</p>
                        <p className="text-xs leading-relaxed text-foreground border border-border rounded-md p-2 bg-background/80 max-h-24 overflow-y-auto">
                          {(displayJob as { summary: string }).summary}
                        </p>
                      </div>
                    ) : null}
                    {(pendingAttachmentFile ||
                      (!attachmentClear && !!formData.attachmentFileId)) ? (
                      <Collapsible
                        open={jobSummaryAttachmentOpen}
                        onOpenChange={setJobSummaryAttachmentOpen}
                        className="pt-2 border-t border-border/80 mt-2"
                      >
                        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-[11px] font-semibold uppercase text-muted-foreground hover:text-foreground">
                          <span className="flex items-center gap-1.5 min-w-0">
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="shrink-0">Prilog uz nalog</span>
                            <span className="font-normal normal-case text-xs text-muted-foreground truncate">
                              · {pendingAttachmentFile?.name ?? formData.attachmentName ?? "fajl"}
                            </span>
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 space-y-2">
                          {pendingAttachmentFile ? (
                            <LocalFileInlinePreview file={pendingAttachmentFile} />
                          ) : (
                            <p className="text-xs text-muted-foreground break-all">
                              Sačuvani prilog: {formData.attachmentName ?? "—"}
                            </p>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Nema podataka za izabrani posao.</p>
                )}
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="type">Tip naloga *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: WorkOrderType) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tip" />
                </SelectTrigger>
                <SelectContent>
                  {manualTypeSelectRows.map((row) => (
                    <SelectItem key={row.value} value={row.value}>
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Opis posla *</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="npr. Merenje 5 prozora na drugom spratu..."
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team">{order ? "Dodeljen tim" : "Dodeljen tim *"}</Label>
              <Select
                value={formData.assignedTeamId || undefined}
                onValueChange={(value) => setFormData({ ...formData, assignedTeamId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tim" />
                </SelectTrigger>
                <SelectContent>
                  {order ? (
                    <SelectItem value={WORK_ORDER_UNASSIGNED_TEAM}>Neraspoređeno (čeka dodelu)</SelectItem>
                  ) : null}
                  {teams?.filter(t => t.active).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="date">{isMeasurementOrInstallationWo ? "Datum i vreme *" : "Datum *"}</Label>
              <WorkOrderScheduleDateTimePicker
                kind={schedulePickerKind}
                inputId="date"
                value={formData.date}
                onChange={(value) => setFormData({ ...formData, date: value })}
                disabled={woSavePending}
                enabled={isOpen && !readOnly}
                excludeWorkOrderId={order?.id}
                dateOnly={!isMeasurementOrInstallationWo}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: WorkOrder["status"]) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Na čekanju</SelectItem>
                  <SelectItem value="in_progress">U toku</SelectItem>
                  <SelectItem value="completed">Završeno</SelectItem>
                  <SelectItem value="canceled">Otkazano</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Collapsible
              open={attachmentEditorOpen}
              onOpenChange={setAttachmentEditorOpen}
              className="rounded-lg border border-border bg-muted/30"
            >
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/50 rounded-t-lg">
                <span className="flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5" />
                  Prilog uz nalog (opciono)
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 px-3 pb-3">
                {!effectiveJobId.trim() ? (
                  <p className="text-xs text-muted-foreground">Izaberite posao da biste mogli da otpremite prilog.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="file"
                        className="cursor-pointer text-xs h-auto py-2"
                        disabled={woSavePending}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (!f) return;
                          setAttachmentClear(false);
                          setPendingAttachmentFile(f);
                        }}
                      />
                    </div>
                    {pendingAttachmentFile ? (
                      <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs break-all leading-snug">{pendingAttachmentFile.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 shrink-0 text-destructive"
                            disabled={woSavePending}
                            onClick={() => setPendingAttachmentFile(null)}
                          >
                            Ukloni izbor
                          </Button>
                        </div>
                        <LocalFileInlinePreview file={pendingAttachmentFile} />
                      </div>
                    ) : null}
                    {order &&
                    order.attachmentFileId &&
                    !pendingAttachmentFile &&
                    !attachmentClear ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Trenutni prilog:</span>
                        <span className="font-medium break-all">{formData.attachmentName || "fajl"}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          disabled={woSavePending}
                          onClick={() => setAttachmentClear(true)}
                        >
                          Ukloni prilog
                        </Button>
                      </div>
                    ) : null}
                    {order && order.attachmentFileId && attachmentClear && !pendingAttachmentFile ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Prilog će biti uklonjen pri čuvanju. Možete izabrati novi fajl umesto toga.
                      </p>
                    ) : null}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            {!order ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Stavke za nalog
                </Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={checklistDraft}
                    onChange={(e) => setChecklistDraft(e.target.value)}
                    placeholder="Šta izmeriti / ugraditi (kratko)…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addPendingChecklistLine();
                      }
                    }}
                  />
                  <Button type="button" variant="secondary" onClick={addPendingChecklistLine} className="shrink-0">
                    Dodaj
                  </Button>
                </div>
                {pendingChecklist.length > 0 ? (
                  <ul className="space-y-1">
                    {pendingChecklist.map((text, idx) => (
                      <li
                        key={`${idx}-${text.slice(0, 40)}`}
                        className="flex items-start justify-between gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm"
                      >
                        <span className="text-foreground leading-snug">{text}</span>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive rounded p-0.5"
                          title="Obriši stavku"
                          onClick={() =>
                            setPendingChecklist((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Lista je opciona; dodajte jasne stavke za ekipu.</p>
                )}
              </div>
            ) : null}

            {formData.type === "production" && (formData.jobId || effectiveJobId) ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Profili i skeniranje bar kodova
                </p>
                <ProductionMaterialTab jobId={formData.jobId || effectiveJobId} mode="production" />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={woSavePending}>
                Otkaži
              </Button>
              <Button type="submit" disabled={woSavePending}>
                {woSavePending ? "Čuvanje…" : "Sačuvaj"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
