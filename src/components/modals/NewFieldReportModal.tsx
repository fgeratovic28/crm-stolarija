import { useState, useEffect, useMemo } from "react";
import { MapPin, Factory, X, Loader2, ClipboardList } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { buildFieldReportPhotoKey, uploadFileToR2 } from "@/lib/r2-storage";
import { extensionFromFile, maybeCompressImageForUpload } from "@/lib/compress-image";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldReports } from "@/hooks/use-field-reports";
import { useJobItems } from "@/hooks/use-job-items";
import {
  canToggleWorkOrderChecklist,
  fieldReportFlowForWorkOrderType,
  isFieldExecutionRole,
} from "@/lib/field-team-access";
import type { FieldReportDetails, WorkOrderType } from "@/types";
import { toggleWorkOrderItem, updateWorkOrderItemMeasurements } from "@/actions/work-order-items";
import { useAuthStore } from "@/stores/auth-store";
import { WoItemMeasurementsField } from "@/components/work-order/WoItemMeasurementsField";
import { ProductionMaterialTab } from "@/components/job-tabs/ProductionMaterialTab";
import { fetchWorkOrderChecklistMeasurementsSummary } from "@/lib/work-order-checklist-report";
import {
  REPORT_FLOW_OPTIONS,
  type ReportFlowChoice,
  filterWorkOrdersByReportChoice,
} from "@/lib/field-report-flow-options";
import { labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import {
  formatWorkOrderDescriptionForWorker,
} from "@/lib/work-order-description-display";
import { useRole } from "@/contexts/RoleContext";
import {
  ReportMissingOnSiteModal,
  type MissingOnSiteApplyResult,
} from "@/components/modals/ReportMissingOnSiteModal";
import { FieldReportPhotoAddTile } from "@/components/shared/FieldReportPhotoAddTile";

interface NewFieldReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId?: string;
  /** Tip iz padajuće liste (Novi izveštaj) pre nego što je izabran RN */
  initialReportFlow?: ReportFlowChoice;
}

const MISSING_OPTIONS: { key: string; label: string }[] = [
  { key: "sol", label: "Sol" },
  { key: "daska", label: "Daska" },
  { key: "komarnici", label: "Komarnici" },
  { key: "drugi_delovi", label: "Drugi delovi" },
];

const ADDITIONAL_OPTIONS: { key: string; label: string }[] = [
  { key: "sol", label: "Sol" },
  { key: "daska", label: "Daska" },
  { key: "komarnici", label: "Komarnici" },
  { key: "nesto_drugo", label: "Nešto drugo" },
];

export function NewFieldReportModal({
  open,
  onOpenChange,
  workOrderId: workOrderIdProp,
  initialReportFlow,
}: NewFieldReportModalProps) {
  const [jobId, setJobId] = useState("");
  const [reportFlowChoice, setReportFlowChoice] = useState<ReportFlowChoice>("standard");
  const [linkedWorkOrderId, setLinkedWorkOrderId] = useState("");

  const resolvedWorkOrderId = useMemo(
    () => workOrderIdProp ?? (linkedWorkOrderId.trim().length > 0 ? linkedWorkOrderId : undefined),
    [workOrderIdProp, linkedWorkOrderId],
  );

  const [address, setAddress] = useState("");

  const [siteCanceled, setSiteCanceled] = useState(false);
  const [canceledAt, setCanceledAt] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [jobCompleted, setJobCompleted] = useState(false);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);

  const [everythingOk, setEverythingOk] = useState(true);
  const [issueReportedAt, setIssueReportedAt] = useState<string | null>(null);
  const [issueNote, setIssueNote] = useState("");
  const [missingItemSelections, setMissingItemSelections] = useState<string[]>([]);
  const [missingDrugiText, setMissingDrugiText] = useState("");
  /** Montaža — više pozicija sa predračuna (polje + „Dodaj“); tekst u „Drugi delovi“ se puni automatski. */
  const [predracunMissingPositions, setPredracunMissingPositions] = useState<string[]>([]);

  const [needsAdditionalItems, setNeedsAdditionalItems] = useState(false);
  const [additionalReqAt, setAdditionalReqAt] = useState<string | null>(null);
  const [additionalNeedSelections, setAdditionalNeedSelections] = useState<string[]>([]);
  const [additionalNestoDrugoText, setAdditionalNestoDrugoText] = useState("");

  const [measurements, setMeasurements] = useState("");
  const [estimatedInstallationHours, setEstimatedInstallationHours] = useState<string>("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [missingOnSiteModalOpen, setMissingOnSiteModalOpen] = useState(false);
  const [addonQuoteSiteRequest, setAddonQuoteSiteRequest] = useState(false);

  const { toast } = useToast();
  const { createReport } = useFieldReports();

  const { data: jobs } = useQuery({
    queryKey: ["jobs-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, installation_address, customer:customers(name)");
      if (error) throw error;
      return data;
    },
    enabled: open && !workOrderIdProp,
  });

  const { data: jobWorkOrdersRaw } = useQuery({
    queryKey: ["job-work-orders-report-picker", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, type, status, description, date")
        .eq("job_id", jobId)
        .order("date", { ascending: false });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: open && !workOrderIdProp && !!jobId && reportFlowChoice !== "standard",
  });

  const filteredWorkOrdersPick = useMemo(
    () => filterWorkOrdersByReportChoice(jobWorkOrdersRaw ?? [], reportFlowChoice),
    [jobWorkOrdersRaw, reportFlowChoice],
  );

  const { data: workOrderData } = useQuery({
    queryKey: ["work-order", resolvedWorkOrderId],
    queryFn: async () => {
      if (!resolvedWorkOrderId) return null;
      const { data, error } = await supabase
        .from("work_orders")
        .select(`
          *,
          job:jobs (
            id,
            job_number,
            installation_address,
            customer:customers (name)
          )
        `)
        .eq("id", resolvedWorkOrderId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: open && !!resolvedWorkOrderId,
  });

  const reportVariant = useMemo(() => {
    if (workOrderData?.type) {
      return fieldReportFlowForWorkOrderType(workOrderData.type as WorkOrderType);
    }
    if (!workOrderIdProp && reportFlowChoice === "production") return "production";
    if (!workOrderIdProp && reportFlowChoice === "mounting") return "mounting";
    return "field";
  }, [workOrderData?.type, workOrderIdProp, reportFlowChoice]);

  const isProductionReport = reportVariant === "production";
  const installationMountingReport =
    reportVariant === "mounting" && workOrderData?.type === "installation";
  const isMeasurementWorkOrder =
    workOrderData?.type === "measurement" || workOrderData?.type === "measurement_verification";
  /** Merenje „Nije u redu“ — dovoljan je opis problema; mere, slike i sati nisu obavezni. */
  const measurementIssueOnly =
    isMeasurementWorkOrder && !everythingOk && !siteCanceled && !isProductionReport;
  const measurementNeedsFullCapture =
    isMeasurementWorkOrder && everythingOk && !siteCanceled;
  const showWorkOrderChecklistInReport =
    measurementNeedsFullCapture || (installationMountingReport && !siteCanceled);
  /** Montaža — fotografija obavezna za sve što nije otkazano (otkaz ne prikazuje polje uopšte). */
  const mountingPhotosOptional = false;
  const { items: productionItems } = useJobItems(isProductionReport && jobId ? jobId : undefined);

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { canPerformAction } = useRole();

  const workOrderForChecklistPerm = useMemo(() => {
    if (!workOrderData?.type) return null;
    const row = workOrderData as { type: WorkOrderType; team_id?: string | null };
    return {
      type: row.type,
      assignedTeamId: typeof row.team_id === "string" ? row.team_id : undefined,
    };
  }, [workOrderData]);

  const woInProgress = workOrderData?.status === "in_progress";
  const canToggleChecklistByRole = !!workOrderForChecklistPerm &&
    canToggleWorkOrderChecklist(workOrderForChecklistPerm, user?.role, user?.teamId ?? undefined);
  /** Terenske uloge: stavke samo dok je nalog u toku (nakon pokretanja), ne iz detalja naloga. */
  const canEditWorkOrderChecklistItems =
    canToggleChecklistByRole && (!isFieldExecutionRole(user?.role) || woInProgress);

  const { data: workOrderChecklistItems, isLoading: workOrderChecklistItemsLoading } = useQuery({
    queryKey: ["work-order-items", resolvedWorkOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_items")
        .select("id, work_order_id, description, is_completed, measurements")
        .eq("work_order_id", resolvedWorkOrderId!)
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
    enabled:
      open &&
      !!resolvedWorkOrderId &&
      (isMeasurementWorkOrder || installationMountingReport),
  });

  const [toggleWoItemPendingId, setToggleWoItemPendingId] = useState<string | null>(null);
  const toggleWoItemMutation = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      toggleWorkOrderItem(itemId, completed),
    onMutate: (v) => setToggleWoItemPendingId(v.itemId),
    onSettled: () => setToggleWoItemPendingId(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-order-items", resolvedWorkOrderId] });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: error instanceof Error ? error.message : "Ažuriranje stavke nije uspelo.",
        variant: "destructive",
      });
    },
  });

  const saveWoItemMeasuresMutation = useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) =>
      updateWorkOrderItemMeasurements(itemId, text),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-order-items", resolvedWorkOrderId] });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: error instanceof Error ? error.message : "Čuvanje mera nije uspelo.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (open && !workOrderIdProp && initialReportFlow) {
      setReportFlowChoice(initialReportFlow);
      setLinkedWorkOrderId("");
    }
  }, [open, workOrderIdProp, initialReportFlow]);

  useEffect(() => {
    if (!open) {
      setReportFlowChoice("standard");
      setLinkedWorkOrderId("");
      setMissingOnSiteModalOpen(false);
    }
  }, [open]);

  useEffect(() => {
    const row = workOrderData as { job_id?: string } | undefined;
    if (!row?.job_id) return;
    setJobId(row.job_id);
    const instal = row as {
      job?: { installation_address?: string | null };
    };
    setAddress(instal.job?.installation_address || "");
  }, [workOrderData]);

  /** Proizvodnja ne koristi terenske prekidače — ne ostavljaj stare vrednosti pri promeni naloga. */
  useEffect(() => {
    if (!workOrderData?.type || workOrderData.type !== "production") return;
    setSiteCanceled(false);
    setCanceledAt(null);
    setCancelReason("");
  }, [workOrderData?.id, workOrderData?.type]);

  /** Merenje nema blok „Da li treba nešto još?“ — očisti stanje pri prelasku na merenje. */
  useEffect(() => {
    if (!isMeasurementWorkOrder) return;
    setNeedsAdditionalItems(false);
    setAdditionalReqAt(null);
    setAdditionalNeedSelections([]);
    setAdditionalNestoDrugoText("");
  }, [isMeasurementWorkOrder, workOrderData?.id]);

  useEffect(() => {
    if (!missingItemSelections.includes("drugi_delovi")) {
      setPredracunMissingPositions([]);
    }
  }, [missingItemSelections]);

  const resetForm = () => {
    setJobId("");
    setAddress("");
    setSiteCanceled(false);
    setCanceledAt(null);
    setCancelReason("");
    setJobCompleted(false);
    setFinishedAt(null);
    setEverythingOk(true);
    setIssueReportedAt(null);
    setIssueNote("");
    setMissingItemSelections([]);
    setMissingDrugiText("");
    setPredracunMissingPositions([]);
    setNeedsAdditionalItems(false);
    setAdditionalReqAt(null);
    setAdditionalNeedSelections([]);
    setAdditionalNestoDrugoText("");
    setMeasurements("");
    setEstimatedInstallationHours("");
    setGeneralNotes("");
    setImages([]);
    setAddonQuoteSiteRequest(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const prepared = await maybeCompressImageForUpload(file);
        const fileExt = extensionFromFile(prepared);
        const fileName = `${Math.random()}.${fileExt}`;
        const objectKey = buildFieldReportPhotoKey(fileName);
        const publicUrl = await uploadFileToR2(objectKey, prepared);
        setImages((prev) => [...prev, publicUrl]);
      }
      toast({ title: "Fajlovi uspešno otpremljeni" });
    } catch (err) {
      console.error("Upload error:", err);
      toast({ title: "Greška pri otpremanju", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const stampNow = () => new Date().toISOString();

  const toggleCanceled = (v: boolean) => {
    setSiteCanceled(v);
    if (v) setCanceledAt(stampNow());
    else {
      setCanceledAt(null);
      setCancelReason("");
    }
  };

  const toggleFinished = (v: boolean) => {
    setJobCompleted(v);
    if (v) setFinishedAt(stampNow());
    else setFinishedAt(null);
  };

  const toggleEverythingOk = (v: boolean) => {
    setEverythingOk(v);
    if (!v) setIssueReportedAt(stampNow());
    else {
      setAddonQuoteSiteRequest(false);
      setIssueReportedAt(null);
      setIssueNote("");
      setMissingItemSelections([]);
      setMissingDrugiText("");
      setPredracunMissingPositions([]);
    }
  };

  const toggleAdditional = (v: boolean) => {
    setNeedsAdditionalItems(v);
    if (v) setAdditionalReqAt(stampNow());
    else {
      setAdditionalReqAt(null);
      setAdditionalNeedSelections([]);
      setAdditionalNestoDrugoText("");
      setMissingOnSiteModalOpen(false);
      setAddonQuoteSiteRequest(false);
      setPredracunMissingPositions([]);
    }
  };

  const applyMissingOnSiteToForm = (payload: MissingOnSiteApplyResult) => {
    if (payload.flow === "proforma_position") {
      setAddonQuoteSiteRequest(false);
      const incoming = payload.positions.map((p) => p.trim()).filter(Boolean);
      if (incoming.length === 0) return;
      const nowIso = stampNow();
      setPredracunMissingPositions((prev) => {
        const seen = new Set(prev.map((p) => p.toLowerCase()));
        const next = [...prev];
        for (const p of incoming) {
          const k = p.toLowerCase();
          if (!seen.has(k)) {
            next.push(p);
            seen.add(k);
          }
        }
        if (next.length > 0) {
          setMissingDrugiText(`Pozicije ${next.join(", ")} — nedostaju na terenu (predračun)`);
        }
        return next;
      });
      setMissingItemSelections((prev) => (prev.includes("drugi_delovi") ? prev : [...prev, "drugi_delovi"]));
      setEverythingOk(false);
      setIssueReportedAt((t) => t ?? nowIso);
      return;
    }
    setAddonQuoteSiteRequest(true);
    setNeedsAdditionalItems(true);
    setAdditionalReqAt(stampNow());
    setAdditionalNeedSelections((prev) => (prev.includes("nesto_drugo") ? prev : [...prev, "nesto_drugo"]));
    setAdditionalNestoDrugoText(payload.text.trim());
  };

  const handleSubmit = async () => {
    const resolvedAddress = isProductionReport
      ? (
          address.trim() ||
          (workOrderData as { job?: { installation_address?: string | null } } | null)?.job
            ?.installation_address ||
          ""
        ).trim()
      : address.trim();

    if (!workOrderIdProp && reportFlowChoice !== "standard" && !resolvedWorkOrderId) {
      toast({
        title: "Izaberite radni nalog",
        description:
          REPORT_FLOW_OPTIONS.find((o) => o.value === reportFlowChoice)?.label ??
          "Ovaj tip izveštaja zahteva povezan radni nalog.",
        variant: "destructive",
      });
      return;
    }

    if (!jobId || !resolvedAddress) {
      toast({
        title: "Popunite obavezna polja",
        description: isProductionReport
          ? "Nedostaje adresa ugradnje na poslu (proverite karticu posla)."
          : undefined,
        variant: "destructive",
      });
      return;
    }
    if (reportVariant === "mounting" && images.length === 0 && !mountingPhotosOptional) {
      toast({
        title: "Dodajte bar jednu sliku",
        description: "Za predaju montaže potrebno je dodati bar jednu sliku.",
        variant: "destructive",
      });
      return;
    }
    const effectiveSiteCanceled = isProductionReport ? false : siteCanceled;
    if (effectiveSiteCanceled && !cancelReason.trim()) {
      toast({ title: "Upišite razlog otkazivanja", variant: "destructive" });
      return;
    }
    if (!generalNotes.trim()) {
      if (!measurementIssueOnly || !issueNote.trim()) {
        toast({ title: "Napišite generalni izveštaj", variant: "destructive" });
        return;
      }
    }

    const nowIso = stampNow();
    const resolvedMissing: string[] = [];
    if (!(isMeasurementWorkOrder && !everythingOk)) {
      for (const k of missingItemSelections) {
        if (k === "drugi_delovi") {
          const t = missingDrugiText.trim();
          if (!t) {
            toast({ title: "Upišite koji su drugi delovi", variant: "destructive" });
            return;
          }
          resolvedMissing.push(t);
        } else {
          resolvedMissing.push(MISSING_OPTIONS.find((o) => o.key === k)?.label ?? k);
        }
      }
    }

    const resolvedAdditional: string[] = [...additionalNeedSelections.filter((k) => k !== "nesto_drugo")];
    if (additionalNeedSelections.includes("nesto_drugo")) {
      const t = additionalNestoDrugoText.trim();
      if (!t) {
        toast({ title: "Upišite šta još treba (Nešto drugo)", variant: "destructive" });
        return;
      }
      resolvedAdditional.push(t);
    }

    if (!everythingOk && isMeasurementWorkOrder) {
      if (!issueNote.trim()) {
        toast({
          title: "Upišite šta nije bilo u redu",
          description: "Kratko opišite problem na merenju.",
          variant: "destructive",
        });
        return;
      }
    } else if (!everythingOk || (effectiveSiteCanceled && missingItemSelections.length > 0)) {
      const hasStd = missingItemSelections.some((k) => k !== "drugi_delovi");
      const hasDrugi = missingItemSelections.includes("drugi_delovi") && missingDrugiText.trim().length > 0;
      if (!hasStd && !hasDrugi) {
        toast({ title: "Izaberite šta nije u redu / nije isporučeno", variant: "destructive" });
        return;
      }
    }

    if (
      installationMountingReport &&
      !isMeasurementWorkOrder &&
      missingItemSelections.includes("drugi_delovi") &&
      canPerformAction("add_mounting_report") &&
      Boolean(resolvedWorkOrderId) &&
      (/\b(predračun|predracun)\b/i.test(missingDrugiText) || predracunMissingPositions.length > 0) &&
      predracunMissingPositions.length === 0
    ) {
      toast({
        title: "Dodajte pozicije sa predračuna",
        description: "Za svaku faleću poziciju upišite broj ili oznaku i kliknite „Dodaj“ (lista ispod).",
        variant: "destructive",
      });
      return;
    }

    if (!isMeasurementWorkOrder && needsAdditionalItems && resolvedAdditional.length === 0) {
      const allowEmptyAdditionalForMounting =
        reportVariant === "mounting" && workOrderData?.type === "installation";
      if (!allowEmptyAdditionalForMounting) {
        toast({ title: "Izaberite šta još treba", variant: "destructive" });
        return;
      }
    }

    let measurementsPayload = measurements.trim();
    if (measurementNeedsFullCapture && resolvedWorkOrderId) {
      try {
        const checklistBlock = await fetchWorkOrderChecklistMeasurementsSummary(supabase, resolvedWorkOrderId);
        measurementsPayload = [checklistBlock, measurementsPayload]
          .filter((s) => s.trim().length > 0)
          .join("\n\n")
          .trim();
      } catch (mergeErr) {
        toast({
          title: "Greška pri učitavanju mera iz stavki naloga",
          description: mergeErr instanceof Error ? mergeErr.message : undefined,
          variant: "destructive",
        });
        return;
      }
    }

    if (measurementNeedsFullCapture) {
      if (!measurementsPayload.trim()) {
        toast({
          title: "Upišite mere",
          description: "Polje „mere“ u izveštaju ili mere uz stavke čekliste uz merenju.",
          variant: "destructive",
        });
        return;
      }
      const hoursNum = Number(estimatedInstallationHours.replace(",", "."));
      if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
        toast({
          title: "Procenjeno vreme ugradnje",
          description: "Unesite broj sati veći od 0.",
          variant: "destructive",
        });
        return;
      }
    }

    const woStatus = workOrderData?.status as string | undefined;
    const fieldStartedAtFromWo =
      workOrderData &&
      typeof (workOrderData as { field_started_at?: unknown }).field_started_at === "string"
        ? (workOrderData as { field_started_at: string }).field_started_at.trim()
        : "";
    const derivedArrived =
      !isProductionReport && !!resolvedWorkOrderId && woStatus === "in_progress";
    const derivedArrivalAt = derivedArrived
      ? fieldStartedAtFromWo.length > 0
        ? fieldStartedAtFromWo
        : nowIso
      : undefined;

    const details: FieldReportDetails = {};
    if (derivedArrivalAt) details.arrivedAt = derivedArrivalAt;
    if (!isProductionReport && effectiveSiteCanceled) details.canceledAt = canceledAt ?? nowIso;

    const resolvedJobCompleted = isProductionReport ? jobCompleted : !effectiveSiteCanceled;
    if (resolvedJobCompleted) {
      details.finishedAt = isProductionReport ? (finishedAt ?? nowIso) : nowIso;
    }

    if (!everythingOk || missingItemSelections.length > 0) details.issueReportedAt = issueReportedAt ?? nowIso;
    if (!isMeasurementWorkOrder && needsAdditionalItems) details.additionalReqAt = additionalReqAt ?? nowIso;
    const isInstallationWo = workOrderData?.type === "installation";
    const deferInstallWoForInvoiceMissingPredracun =
      isInstallationWo &&
      missingItemSelections.includes("drugi_delovi") &&
      (/\b(predračun|predracun)\b/i.test(missingDrugiText) || predracunMissingPositions.length > 0);
    if (deferInstallWoForInvoiceMissingPredracun) {
      details.invoiceMissingDeferAutoInstallationWo = true;
      const sitePos = [...new Set(predracunMissingPositions.map((p) => p.trim()).filter(Boolean))];
      if (sitePos.length > 0) {
        details.invoiceMissingSitePositions = sitePos;
      }
    }
    if (isProductionReport) {
      details.productionCompletedItems = productionItems
        .filter((item) => item.isCompleted)
        .map((item) => ({
          profileCode: item.profileCode || undefined,
          profileTitle: item.profileTitle || item.profileCode || "Element",
          barcode: item.barcode,
          completedAt: item.completedAt,
        }));
    }

    const missingLabelParts: string[] = missingItemSelections
      .filter((k) => k !== "drugi_delovi")
      .map((k) => MISSING_OPTIONS.find((o) => o.key === k)?.label ?? k);
    if (missingItemSelections.includes("drugi_delovi") && missingDrugiText.trim()) {
      missingLabelParts.push(`Drugi delovi: ${missingDrugiText.trim()}`);
    }
    const issuesParts: string[] = [];
    if (isMeasurementWorkOrder && !everythingOk && issueNote.trim()) {
      issuesParts.push(issueNote.trim());
    } else {
      if ((!everythingOk || effectiveSiteCanceled) && missingLabelParts.length > 0) {
        issuesParts.push(`Šta nije u redu / nisu isporučeni elementi: ${missingLabelParts.join(", ")}`);
      }
      if (!everythingOk && issueNote.trim() && !isMeasurementWorkOrder) {
        issuesParts.push(issueNote.trim());
      }
    }
    const issuesCombined = issuesParts.length > 0 ? issuesParts.join("\n\n") : undefined;

    try {
      await createReport.mutateAsync({
        workOrderId: resolvedWorkOrderId,
        jobId,
        address: resolvedAddress,
        arrived: isProductionReport ? false : derivedArrived,
        arrivalDate: derivedArrivalAt,
        siteCanceled: effectiveSiteCanceled,
        cancelReason: effectiveSiteCanceled ? cancelReason.trim() : undefined,
        jobCompleted: resolvedJobCompleted,
        everythingOk,
        issueDescription: issuesCombined,
        images,
        missingItems: resolvedMissing.length > 0 ? resolvedMissing : [],
        additionalNeeds: !isMeasurementWorkOrder && needsAdditionalItems ? resolvedAdditional : [],
        measurements: measurementsPayload.trim() || undefined,
        generalNotes: generalNotes.trim(),
        details,
        estimatedInstallationHours:
          isMeasurementWorkOrder && !effectiveSiteCanceled
            ? Number(estimatedInstallationHours.replace(",", "."))
            : undefined,
        workOrderType:
          (workOrderData?.type as WorkOrderType | undefined) ??
          (!workOrderIdProp && reportFlowChoice === "production" ? "production" : undefined),
        addonQuoteSiteRequest: !isMeasurementWorkOrder ? addonQuoteSiteRequest : false,
      });

      resetForm();
      if (resolvedWorkOrderId) {
        const w = workOrderData as { job_id?: string; job?: { installation_address?: string | null } } | null;
        setJobId(w?.job_id ?? "");
        setAddress(w?.job?.installation_address || "");
      }
      onOpenChange(false);
    } catch {
      /* toast u mutaciji */
    }
  };

  const toggleRowClass = "flex items-center justify-between gap-3 bg-muted/30 rounded-lg p-3";
  const dialogContentClass = isProductionReport
    ? "w-full sm:max-w-6xl max-h-[94vh] overflow-y-auto"
    : "w-full sm:max-w-lg max-h-[90vh] overflow-y-auto";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={dialogContentClass}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reportVariant === "production" ? (
              <Factory className="w-5 h-5 text-primary shrink-0" />
            ) : (
              <MapPin className="w-5 h-5 text-primary shrink-0" />
            )}
            {workOrderData
              ? reportVariant === "mounting"
                ? `Montažni izveštaj — ${workOrderData.job?.job_number}`
                : reportVariant === "production"
                  ? `Izveštaj proizvodnje — ${workOrderData.job?.job_number}`
                  : `Terenski izveštaj — ${workOrderData.job?.job_number}`
              : "Novi terenski izveštaj"}
          </DialogTitle>
        </DialogHeader>

        {installationMountingReport && workOrderData ? (
          <p className="text-sm text-muted-foreground -mt-2 leading-snug">
            {formatWorkOrderDescriptionForWorker(
              typeof workOrderData.description === "string" ? workOrderData.description : "",
              "installation",
            )}
          </p>
        ) : null}

        <div className="space-y-4 pt-2">
          {!workOrderIdProp && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Posao *</Label>
                <Select
                  value={jobId}
                  onValueChange={(v) => {
                    setJobId(v);
                    setLinkedWorkOrderId("");
                    const job = jobs?.find((j) => j.id === v);
                    if (job) setAddress(job.installation_address || "");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Izaberite posao" />
                  </SelectTrigger>
                  <SelectContent>
                    {jobs?.map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.job_number} — {Array.isArray(j.customer) ? j.customer[0]?.name : j.customer?.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tip izveštaja *</Label>
                <Select
                  value={reportFlowChoice}
                  onValueChange={(v) => {
                    setReportFlowChoice(v as ReportFlowChoice);
                    setLinkedWorkOrderId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Izaberite tip" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_FLOW_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {REPORT_FLOW_OPTIONS.find((o) => o.value === reportFlowChoice)?.hint}
                </p>
              </div>

              {reportFlowChoice !== "standard" && jobId ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Radni nalog za izabrani tip *
                  </Label>
                  <Select
                    value={linkedWorkOrderId}
                    onValueChange={(v) => setLinkedWorkOrderId(v)}
                    disabled={(filteredWorkOrdersPick?.length ?? 0) === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          (filteredWorkOrdersPick?.length ?? 0) === 0
                            ? "Nema naloga ovog tipa za posao"
                            : "Izaberite radni nalog"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(filteredWorkOrdersPick ?? []).map((wo) => (
                        <SelectItem key={wo.id as string} value={wo.id as string}>
                          {labelWorkOrderType(wo.type as WorkOrderType)} · {labelWorkOrderStatus(wo.status as string)} ·{" "}
                          {new Date(String(wo.date)).toLocaleDateString("sr-Latn")}{" "}
                          {(() => {
                            const desc = formatWorkOrderDescriptionForWorker(
                              wo.description as string,
                              wo.type as WorkOrderType,
                            );
                            return desc ? `— ${desc.slice(0, 52)}${desc.length > 52 ? "…" : ""}` : "";
                          })()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(filteredWorkOrdersPick ?? []).length === 0 ? (
                    <p className="text-[11px] text-amber-800 dark:text-amber-400/90">
                      Nema aktivnog ili dostupnog radnog naloga ovog tipa za izabrani posao. Koristite „Terenski
                      (opšte)“, kreirajte nalog ili proverite karticu Radni nalozi.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {isProductionReport ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Posao / adresa ugradnje (referenca)</Label>
              <p className="text-sm rounded-md border border-border bg-muted/30 px-3 py-2">
                {workOrderData?.job?.installation_address?.trim() || address.trim() || "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Ovaj izveštaj je za rad u proizvodnji; adresa je veza ka poslu i ugradnji kod klijenta.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Adresa terena *</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Unesite adresu" />
            </div>
          )}

          {installationMountingReport &&
          resolvedWorkOrderId &&
          showWorkOrderChecklistInReport ? (
            <section className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Ugradnja</p>
              {workOrderChecklistItemsLoading ? (
                <p className="text-xs text-muted-foreground">Učitavanje stavki naloga…</p>
              ) : null}
              {!workOrderChecklistItemsLoading &&
              workOrderChecklistItems &&
              workOrderChecklistItems.length > 0 ? (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" />
                    Šta ugraditi (stavke naloga)
                  </h3>
                  <ul className="rounded-xl border border-border divide-y divide-border bg-card">
                    {workOrderChecklistItems.map((row) => (
                      <li key={row.id} className="flex gap-3 items-start px-3 py-3 text-sm">
                        <Checkbox
                          id={`install-wo-item-${row.id}`}
                          className="mt-0.5"
                          checked={row.isCompleted}
                          disabled={
                            !canEditWorkOrderChecklistItems ||
                            (toggleWoItemMutation.isPending && toggleWoItemPendingId === row.id)
                          }
                          onCheckedChange={(c) =>
                            toggleWoItemMutation.mutate({
                              itemId: row.id,
                              completed: c === true,
                            })
                          }
                        />
                        <Label
                          htmlFor={`install-wo-item-${row.id}`}
                          className={cn(
                            "leading-snug cursor-pointer flex-1 min-w-0 text-xs",
                            !canEditWorkOrderChecklistItems && "cursor-default",
                          )}
                        >
                          <span
                            className={
                              row.isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                            }
                          >
                            {row.description.trim() ? row.description : "—"}
                          </span>
                        </Label>
                      </li>
                    ))}
                  </ul>
                  {!canEditWorkOrderChecklistItems ? (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {!canToggleChecklistByRole
                        ? "Ovaj nalog nije dodeljen vašem timu ili uloga nema ovlašćenje — stavke su samo za pregled."
                        : "Pokrenite radni nalog (status „U toku“) da biste ovde označili urađene stavke."}
                    </p>
                  ) : null}
                </>
              ) : !workOrderChecklistItemsLoading ? (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Nema stavki na nalogu — proverite da li je ugradnja zakazana sa listom radova u kancelariji.
                </p>
              ) : null}
            </section>
          ) : null}

          {isProductionReport && jobId ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Forma naloga za proizvodnju (profili + skeniranje)
              </p>
              <ProductionMaterialTab jobId={jobId} mode="production" />
            </div>
          ) : null}

          {!isProductionReport && (
            <>
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <Label className="text-sm font-medium">Da li je teren otkazan?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={siteCanceled ? "default" : "outline"}
                    className={cn(
                      "h-11 border-2 font-semibold transition-none",
                      siteCanceled
                        ? "border-primary shadow-sm ring-2 ring-primary/20 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                        : "border-border bg-background hover:bg-background hover:text-foreground hover:border-border",
                    )}
                    onClick={() => toggleCanceled(true)}
                  >
                    Da
                  </Button>
                  <Button
                    type="button"
                    variant={!siteCanceled ? "default" : "outline"}
                    className={cn(
                      "h-11 border-2 font-semibold transition-none",
                      !siteCanceled
                        ? "border-primary shadow-sm ring-2 ring-primary/20 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                        : "border-border bg-background hover:bg-background hover:text-foreground hover:border-border",
                    )}
                    onClick={() => toggleCanceled(false)}
                  >
                    Ne
                  </Button>
                </div>
              </div>

              {siteCanceled && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Upiši razlog otkazivanja *</Label>
                  <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Razlog" />
                </div>
              )}
            </>
          )}

          <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
            <Label className="text-sm font-medium">Da li je sve bilo u redu?</Label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-auto min-h-[3.5rem] border-2 py-2.5 text-sm font-semibold whitespace-normal transition-none",
                  !everythingOk
                    ? "border-destructive/70 bg-destructive/10 text-foreground shadow-sm ring-2 ring-destructive/25 hover:bg-destructive/10 hover:border-destructive/70 hover:text-foreground"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-background/50 hover:border-border hover:text-muted-foreground",
                )}
                onClick={() => toggleEverythingOk(false)}
              >
                Nije u redu
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-auto min-h-[3.5rem] border-2 py-2.5 text-sm font-semibold whitespace-normal transition-none",
                  everythingOk
                    ? "border-emerald-600/70 bg-emerald-500/10 text-foreground shadow-sm ring-2 ring-emerald-600/25 hover:bg-emerald-500/10 hover:border-emerald-600/70 hover:text-foreground"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-background/50 hover:border-border hover:text-muted-foreground",
                )}
                onClick={() => toggleEverythingOk(true)}
              >
                Sve u redu
              </Button>
            </div>
          </div>

          {!everythingOk && (
            <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
              {isMeasurementWorkOrder && !everythingOk ? (
                <>
                  <p className="text-xs font-semibold text-foreground">Šta nije bilo u redu? *</p>
                  <Textarea
                    value={issueNote}
                    onChange={(e) => setIssueNote(e.target.value)}
                    rows={4}
                    placeholder="Kratko opišite problem na merenju…"
                    className="text-sm"
                  />
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold text-foreground">Šta nije u redu / Nisu isporučeni elementi</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {MISSING_OPTIONS.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                        <Checkbox
                          checked={missingItemSelections.includes(item.key)}
                          onCheckedChange={(checked) => {
                            setMissingItemSelections((prev) =>
                              checked ? [...prev, item.key] : prev.filter((v) => v !== item.key),
                            );
                          }}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                  {missingItemSelections.includes("drugi_delovi") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Upiši koji *</Label>
                      <Input
                        value={missingDrugiText}
                        onChange={(e) => setMissingDrugiText(e.target.value)}
                        placeholder="Npr. okvir za roletnu…"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Dodatni opis (opciono)</Label>
                    <Textarea value={issueNote} onChange={(e) => setIssueNote(e.target.value)} rows={2} />
                  </div>
                </>
              )}
            </div>
          )}

          {!isMeasurementWorkOrder && (
            <>
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <Label className="text-sm font-medium">Da li treba nešto još?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={needsAdditionalItems ? "default" : "outline"}
                    className={cn(
                      "h-11 border-2 font-semibold transition-none",
                      needsAdditionalItems
                        ? "border-primary shadow-sm ring-2 ring-primary/20 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                        : "border-border bg-background hover:bg-background hover:text-foreground hover:border-border",
                    )}
                    onClick={() => toggleAdditional(true)}
                  >
                    Da
                  </Button>
                  <Button
                    type="button"
                    variant={!needsAdditionalItems ? "default" : "outline"}
                    className={cn(
                      "h-11 border-2 font-semibold transition-none",
                      !needsAdditionalItems
                        ? "border-primary shadow-sm ring-2 ring-primary/20 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                        : "border-border bg-background hover:bg-background hover:text-foreground hover:border-border",
                    )}
                    onClick={() => toggleAdditional(false)}
                  >
                    Ne
                  </Button>
                </div>
              </div>

              {needsAdditionalItems && (
                <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
                  {reportVariant === "mounting" &&
                    workOrderData?.type === "installation" &&
                    canPerformAction("add_mounting_report") &&
                    resolvedWorkOrderId && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/25 p-3 -mt-1 mb-1">
                        <div className="flex items-start gap-2">
                          <ClipboardList className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-sm font-medium leading-tight">Da li treba još nešto?</p>
                            <p className="text-xs text-muted-foreground leading-snug">
                              Stavka sa predračuna (hitno Nabavka/Proizvodnja): u modalu dodajte jednu ili više pozicija
                              koje fale. Tražena dopuna / mere za novu ponudu (Prodaja) — drugi korak u istom modalu.
                              Posle čuvanja izveštaja radi postojeća automatika.
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          onClick={() => setMissingOnSiteModalOpen(true)}
                        >
                          Prijavi nedostatak na terenu
                        </Button>
                      </div>
                    )}

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ADDITIONAL_OPTIONS.map((item) => (
                      <label key={item.key} className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
                        <Checkbox
                          checked={additionalNeedSelections.includes(item.key)}
                          onCheckedChange={(checked) => {
                            setAdditionalNeedSelections((prev) =>
                              checked ? [...prev, item.key] : prev.filter((v) => v !== item.key),
                            );
                          }}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                  {additionalNeedSelections.includes("nesto_drugo") && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Upiši šta *</Label>
                      <Input
                        value={additionalNestoDrugoText}
                        onChange={(e) => setAdditionalNestoDrugoText(e.target.value)}
                        placeholder="Opis"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {isProductionReport ? (
            <div className={cn(toggleRowClass, "flex-col items-stretch sm:flex-row sm:items-center")}>
              <div className="flex-1">
                <Label className="text-sm cursor-pointer" htmlFor="completed">
                  Da li je posao u proizvodnji završen?
                </Label>
              </div>
              <Switch id="completed" checked={jobCompleted} onCheckedChange={(c) => toggleFinished(!!c)} />
            </div>
          ) : null}

          {isMeasurementWorkOrder && (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide">Merenje</p>

              {measurementIssueOnly ? (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Za prijavu problema dovoljan je opis iznad. Mere, skica/fotografija i procena sati ugradnje nisu
                  obavezni.
                </p>
              ) : null}

              {measurementNeedsFullCapture && resolvedWorkOrderId ? (
                <>
                  {workOrderChecklistItemsLoading ? (
                    <p className="text-xs text-muted-foreground">Učitavanje stavki naloga…</p>
                  ) : null}
                  {!workOrderChecklistItemsLoading &&
                  workOrderChecklistItems &&
                  workOrderChecklistItems.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                        <ClipboardList className="w-3.5 h-3.5" />
                        Stavke naloga (mere po stavci)
                      </h3>
                      <ul className="rounded-xl border border-border divide-y divide-border bg-card">
                        {workOrderChecklistItems.map((row) => (
                          <li key={row.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                            <div className="flex gap-3 items-start">
                              <Checkbox
                                id={`report-wo-item-${row.id}`}
                                className="mt-0.5"
                                checked={row.isCompleted}
                                disabled={
                                  !canEditWorkOrderChecklistItems ||
                                  (toggleWoItemMutation.isPending && toggleWoItemPendingId === row.id)
                                }
                                onCheckedChange={(c) =>
                                  toggleWoItemMutation.mutate({
                                    itemId: row.id,
                                    completed: c === true,
                                  })
                                }
                              />
                              <Label
                                htmlFor={`report-wo-item-${row.id}`}
                                className={cn(
                                  "leading-snug cursor-pointer flex-1 min-w-0 text-xs",
                                  !canEditWorkOrderChecklistItems && "cursor-default",
                                )}
                              >
                                <span
                                  className={
                                    row.isCompleted ? "line-through text-muted-foreground" : "text-foreground"
                                  }
                                >
                                  {row.description.trim() ? row.description : "—"}
                                </span>
                              </Label>
                            </div>
                            <WoItemMeasurementsField
                              row={{ id: row.id, measurements: row.measurements }}
                              disabledSaving={!canEditWorkOrderChecklistItems}
                              isSaving={
                                saveWoItemMeasuresMutation.isPending &&
                                saveWoItemMeasuresMutation.variables?.itemId === row.id
                              }
                              onSave={(itemId, text) =>
                                saveWoItemMeasuresMutation.mutate({ itemId, text })
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      {!canEditWorkOrderChecklistItems ? (
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {!canToggleChecklistByRole
                            ? "Ovaj nalog nije dodeljen vašem timu ili uloga nema ovlašćenje — stavke su samo za pregled."
                            : "Pokrenite radni nalog (status „U toku“) da biste ovde čekirali stavke i uneli mere."}
                        </p>
                      ) : null}
                    </section>
                  ) : !workOrderChecklistItemsLoading ? (
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Nema definisanih stavki ček liste na ovom nalogu. Mere možete upisati ispod kao ceo izveštaj.
                    </p>
                  ) : null}
                </>
              ) : null}

              {measurementNeedsFullCapture ? (
              <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Mere za izveštaj *</Label>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Mere uz stavke iznad čuvaju se na nalog; pri čuvanju izveštaja automatski se dodaju u blok „mere“. Ovde dopišite opšti tekst ili dodatno ako treba.
                </p>
                <Textarea
                  value={measurements}
                  onChange={(e) => setMeasurements(e.target.value)}
                  placeholder="Dodatni opis ili mere koje želite u celom izveštaju…"
                  rows={3}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Skica / fotografija (opciono)</Label>
                <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {images.map((img, i) => (
                    <div key={i} className="relative aspect-square rounded-md overflow-hidden group">
                      <img src={img} alt="Prilog" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <FieldReportPhotoAddTile uploading={uploading} onChange={handleImageUpload} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                  Procenjeno vreme ugradnje (u satima) *
                </Label>
                <Input
                  type="number"
                  min={0.25}
                  step={0.25}
                  inputMode="decimal"
                  value={estimatedInstallationHours}
                  onChange={(e) => setEstimatedInstallationHours(e.target.value)}
                  placeholder="npr. 4"
                />
              </div>
              </>
              ) : null}
            </div>
          )}

          {(!isMeasurementWorkOrder || reportVariant === "mounting") &&
            !(reportVariant === "mounting" && siteCanceled) && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {reportVariant === "mounting"
                  ? "Slike i dokumentacija predaje *"
                  : reportVariant === "production"
                    ? "Fotografije / prilozi (opciono)"
                    : "Fotografije sa terena (opciono)"}
              </Label>
              <div className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden group">
                    <img
                      src={img}
                      alt={reportVariant === "production" ? "Prilog" : "Teren"}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <FieldReportPhotoAddTile uploading={uploading} onChange={handleImageUpload} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {isProductionReport ? "Napiši izveštaj (proizvodnja) *" : "Napiši generalni izveštaj *"}
            </Label>
            <Textarea
              value={generalNotes}
              onChange={(e) => setGeneralNotes(e.target.value)}
              placeholder={
                isProductionReport
                  ? "Opis izvršenih radova, materijala, napomena za ugradnju…"
                  : "Kratak rezime poseta…"
              }
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-2 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={createReport.isPending || uploading}>
            {createReport.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Sačuvaj izveštaj
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {missingOnSiteModalOpen ? (
      <ReportMissingOnSiteModal
        open={missingOnSiteModalOpen}
        onOpenChange={setMissingOnSiteModalOpen}
        jobNumber={(workOrderData?.job as { job_number?: string } | undefined)?.job_number}
        onApply={applyMissingOnSiteToForm}
      />
    ) : null}
    </>
  );
}
