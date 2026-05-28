import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Package,
  CheckCircle,
  Edit2,
  Trash2,
  FileText,
  Upload,
  Printer,
  ExternalLink,
  Loader2,
  PackageCheck,
  FileSearch2,
  Banknote,
  Mail,
  ScanBarcode,
  AlertTriangle,
  Eye,
  ChevronDown,
  ChevronUp,
  Building2,
  X,
} from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { JobCustomerLink } from "@/components/shared/JobCustomerLink";
import type { JobDetailsReturnState } from "@/lib/job-details-return";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { DelayedDeliveryBadge } from "@/components/shared/OperationalBadges";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/contexts/RoleContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialOrderForm } from "@/components/shared/MaterialOrderForm";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useMaterialOrderAttachments } from "@/hooks/use-material-order-files";
import { useFiles } from "@/hooks/use-files";
import { useProcurementComplaintsForOrderIds, type ProcurementComplaintWithOrder } from "@/hooks/use-procurement-complaints";
import {
  useProcurementAdHocItemsForOrderIds,
  useDeleteProcurementAdHocItem,
  useUpdateProcurementAdHocItemStatus,
  type ProcurementAdHocItem,
} from "@/hooks/use-procurement-ad-hoc-items";
import { ProcurementAdHocItemModal } from "@/components/modals/ProcurementAdHocItemModal";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { formatCurrencyBySettings, formatMaterialOrderDateForDisplay } from "@/lib/app-settings";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import type { AppFile, MaterialOrder } from "@/types";
import type { MaterialOrderFormValues } from "@/components/shared/MaterialOrderForm";
import { labelMaterialType } from "@/lib/activity-labels";
import { materialOrderSiteHitShowsReceptionBarcode } from "@/lib/invoice-missing-procurement-phase";
import { labelSupplierCategoryForDisplay } from "@/lib/supplier-category-display";
import { exportMaterialOrderPDF } from "@/lib/export-documents";
import { sendMaterialOrderEmailToSupplier } from "@/lib/send-material-order-email-client";
import { mergeDefined } from "@/lib/merge-defined";
import { MaterialOrderInvoiceEvidencijaDialog } from "@/components/modals/MaterialOrderInvoiceEvidencijaDialog";
import { SupplierOrderModal } from "@/components/modals/SupplierOrderModal";
import { MaterialOrderSupplierProformaForm } from "@/components/shared/MaterialOrderSupplierProformaForm";
import { normalizeOrderLines, sumOrderLinesNet } from "@/lib/material-order-lines";
import {
  orderLinesEligibleForProcurementPdf,
  procurementPdfRowsFromOrderLines,
} from "@/lib/material-order-procurement-rows";
import { ProcurementDiscrepancyModal } from "@/components/modals/ProcurementDiscrepancyModal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  PROCUREMENT_COMPLAINT_STATUS,
  isProcurementComplaintActive,
  labelProcurementComplaintStatus,
  normalizeProcurementComplaintStatus,
  procurementComplaintBadgeVariant,
} from "@/lib/procurement-complaint-status";
import {
  PROCUREMENT_AD_HOC_STATUS,
  PROCUREMENT_AD_HOC_STATUS_OPTIONS,
  isProcurementAdHocActive,
  normalizeProcurementAdHocStatus,
  type ProcurementAdHocStatus,
} from "@/lib/procurement-ad-hoc-status";
import { isFieldExecutionRole, isMontazaRole, isTerenRole } from "@/lib/field-team-access";
import { useUrgentSiteMissingNotifications } from "@/hooks/use-urgent-site-missing-notifications";
import { useSecureInvoiceMissingPart } from "@/hooks/use-secure-invoice-missing-part";
import { useInvoiceMissingSendToProcurement } from "@/hooks/use-invoice-missing-send-to-procurement";
import { useInvoiceMissingConfirmProductionSchedule } from "@/hooks/use-invoice-missing-confirm-production-schedule";
import { DashboardUrgentPredracunAlert } from "@/components/dashboard/DashboardUrgentPredracunAlert";
import { InvoiceMissingShortageOrderModal } from "@/components/modals/InvoiceMissingShortageOrderModal";

const deliveryVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  delivered: "success",
  shipped: "info",
  email_sent: "muted",
  pending: "warning",
  partial: "muted",
  sent_to_supplier: "info",
  waiting_for_payment: "warning",
  waiting_for_delivery: "info",
  materials_received: "success",
  received_with_issues: "warning",
};

const deliveryLabels: Record<string, string> = {
  delivered: "Isporučeno",
  shipped: "Na putu",
  email_sent: "Poslat mejl",
  pending: "Na čekanju",
  partial: "Delimično",
  sent_to_supplier: "Poslato dobavljaču",
  waiting_for_payment: "Čeka uplatu",
  waiting_for_delivery: "Plaćeno i čeka se prijem robe i faktura",
  materials_received: "Materijal primljen",
  received_with_issues: "Sa reklamacijom",
};

function materialOrderDeliveryLabel(order: MaterialOrder): string {
  if (order.deliveryStatus === "waiting_for_delivery") {
    const hasInvoiceEvidence = Boolean(order.invoiceFileUrl || order.invoiceNumber);
    return hasInvoiceEvidence
      ? "Plaćeno i čeka se prijem robe"
      : "Plaćeno i čeka se prijem robe i faktura";
  }
  return deliveryLabels[order.deliveryStatus] ?? order.deliveryStatus;
}

function isActiveShortageOrder(o: MaterialOrder): boolean {
  return Boolean(
    o.isShortageOrder &&
      o.deliveryStatus !== "materials_received" &&
      o.deliveryStatus !== "received_with_issues",
  );
}

/** Koja dugmad smeju na kartici — bez dupliranja (npr. PDF samo ovde ili u modalu, ne oba). */
function materialOrderCardActionFlags(
  o: MaterialOrder,
  canCreateOrder: boolean,
  _canFinanceMarkPaidWorkflow: boolean,
  options?: { pendingAdHocCount: number; nbLineCount: number },
) {
  const s = o.deliveryStatus;
  const hasInvoiceEvidence = Boolean(o.invoiceFileUrl || o.invoiceNumber);
  const pendingAdHoc = options?.pendingAdHocCount ?? 0;
  const nbCount = options?.nbLineCount ?? 0;
  if (o.isShortageOrder) {
    const siteHit = Boolean(o.siteMissingFromInstallation);
    const eligibleForPdf = orderLinesEligibleForProcurementPdf(normalizeOrderLines(o));
    const showReceptionBarcode = siteHit
      ? materialOrderSiteHitShowsReceptionBarcode(s, nbCount > 0 || pendingAdHoc > 0 || eligibleForPdf)
      : s === "waiting_for_delivery" && eligibleForPdf;
    /** „Porudžbina po nedostatku" — magacin/nabavka mogu da generišu PDF sa istim barkodovima kao na
     *  originalu (radi referentnog štampanja / arhive). Bez nove molbe za predračun. */
    const showPrinter = canCreateOrder && eligibleForPdf;
    const showMail = siteHit && canCreateOrder && (s === "pending" || s === "email_sent");
    const showInvoiceEvidencija =
      siteHit &&
      canCreateOrder &&
      !hasInvoiceEvidence &&
      ["waiting_for_delivery", "shipped", "partial", "delivered", "materials_received", "received_with_issues"].includes(
        s,
      );
    return {
      showPrinter,
      showMail,
      showInvoiceEvidencija,
      showStigao: false,
      showPaidToggle: false,
      showMarkPaidWorkflow: s === "waiting_for_payment",
      showReceptionBarcode,
      showWorkflowRow: showPrinter || showMail || showInvoiceEvidencija || showReceptionBarcode,
    };
  }
  /** PDF sa kartice: u pending/email_sent PDF ide preko modala „Pošalji porudžbinu…”. */
  const showPrinter = canCreateOrder && s !== "pending" && s !== "email_sent";
  const showMail = canCreateOrder && (s === "pending" || s === "email_sent");
  const showInvoiceEvidencija =
    canCreateOrder &&
    !hasInvoiceEvidence &&
    [
      "waiting_for_delivery",
      "shipped",
      "partial",
      "delivered",
      "materials_received",
      "received_with_issues",
    ].includes(s);
  const showStigao = false;
  const showPaidToggle = false;
  const showMarkPaidWorkflow = s === "waiting_for_payment";
  const showReceptionBarcode =
    s === "waiting_for_delivery" && orderLinesEligibleForProcurementPdf(normalizeOrderLines(o));
  const showWorkflowRow =
    showMail || showInvoiceEvidencija || showStigao || showPaidToggle || showMarkPaidWorkflow || showReceptionBarcode;
  return {
    showPrinter,
    showMail,
    showInvoiceEvidencija,
    showStigao,
    showPaidToggle,
    showMarkPaidWorkflow,
    showReceptionBarcode,
    showWorkflowRow,
  };
}

export function MaterialOrdersTab({
  orders: initialOrders,
  jobId,
  jobListReturn,
}: {
  orders?: MaterialOrder[];
  jobId?: string;
  /** Sa globalne liste narudžbina — dugme Nazad na kartici posla. */
  jobListReturn?: JobDetailsReturnState;
}) {
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { canPerformAction, currentRole, hasAccess } = useRole();
  const { createOrder, updateOrder, deleteOrder, orders: hookedOrders, isLoading: ordersLoading } =
    useMaterialOrders(jobId);
  const { uploadFile, deleteFile } = useFiles();
  const { user } = useAuthStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
   const [editingOrder, setEditingOrder] = useState<MaterialOrder | null>(null);
   const [invoiceDialogOrder, setInvoiceDialogOrder] = useState<MaterialOrder | null>(null);
   const [paymentStepOrder, setPaymentStepOrder] = useState<MaterialOrder | null>(null);
   const [supplierOrderModalOrder, setSupplierOrderModalOrder] = useState<MaterialOrder | null>(null);
   const [supplierEmailSending, setSupplierEmailSending] = useState(false);
   const [pdfExportOrderId, setPdfExportOrderId] = useState<string | null>(null);
   const [complaintModalOrderId, setComplaintModalOrderId] = useState<string | null>(null);
   const [expandedReceptionOrderId, setExpandedReceptionOrderId] = useState<string | null>(null);
   const [adHocOrder, setAdHocOrder] = useState<MaterialOrder | null>(null);
   const [viewSupplier, setViewSupplier] = useState<{ name: string; contact: string; phone: string; address: string; bankAccount?: string; pib?: string; category?: string } | null>(null);
   const updateAdHocStatus = useUpdateProcurementAdHocItemStatus();
   const deleteAdHocItem = useDeleteProcurementAdHocItem();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [materialFilter, setMaterialFilter] = useState<string>("all");
  const [orderKindFilter, setOrderKindFilter] = useState<string>("all");
  const [pendingAutoPdfOrderIds, setPendingAutoPdfOrderIds] = useState<string[]>([]);

  const showUrgentSiteMissingOnJob =
    Boolean(jobId) &&
    (currentRole === "procurement" ||
      currentRole === "production" ||
      currentRole === "admin" ||
      currentRole === "office") &&
    !isMontazaRole(currentRole) &&
    !isTerenRole(currentRole);

  const urgentSiteMissingQuery = useUrgentSiteMissingNotifications(showUrgentSiteMissingOnJob);
  const urgentRowsForJob = useMemo(() => {
    if (!jobId) return [];
    return (urgentSiteMissingQuery.data ?? []).filter((r) => r.jobId === jobId);
  }, [urgentSiteMissingQuery.data, jobId]);

  const secureInvoiceMissing = useSecureInvoiceMissingPart();
  const sendInvoiceMissingToProcurement = useInvoiceMissingSendToProcurement();
  const confirmInvoiceMissingProduction = useInvoiceMissingConfirmProductionSchedule();
  const [urgentProcurementDialog, setUrgentProcurementDialog] = useState<{ jobId: string; position: string } | null>(
    null,
  );

  const canSecureInvoiceMissingPart =
    (currentRole === "admin" || currentRole === "procurement") && !isFieldExecutionRole(currentRole);
  const canConfirmInvoiceMissingProduction =
    currentRole === "admin" || currentRole === "production" || currentRole === "procurement";

  const actionPendingUrgent =
    secureInvoiceMissing.isPending ||
    sendInvoiceMissingToProcurement.isPending ||
    confirmInvoiceMissingProduction.isPending;

  const displayOrdersAll = initialOrders || hookedOrders || [];
  const materialTypeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const o of displayOrdersAll) {
      const v = String(o.materialType ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort((a, b) => labelMaterialType(a as any).localeCompare(labelMaterialType(b as any), "sr"));
  }, [displayOrdersAll]);
  const deliveryStatusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const o of displayOrdersAll) {
      const v = String(o.deliveryStatus ?? "").trim();
      if (v) s.add(v);
    }
    return Array.from(s).sort((a, b) => (deliveryLabels[a] ?? a).localeCompare(deliveryLabels[b] ?? b, "sr"));
  }, [displayOrdersAll]);

  useEffect(() => {
    if (jobId) return;
    const delivery = searchParams.get("delivery");
    if (!delivery) return;
    if (delivery === "pending" || deliveryStatusOptions.includes(delivery)) {
      setStatusFilter(delivery);
    }
  }, [jobId, searchParams, deliveryStatusOptions]);

  const displayOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return displayOrdersAll.filter((o) => {
      if (statusFilter !== "all" && o.deliveryStatus !== statusFilter) return false;
      if (paymentFilter === "paid" && !o.paid) return false;
      if (paymentFilter === "unpaid" && o.paid) return false;
      if (materialFilter !== "all" && o.materialType !== materialFilter) return false;
      if (orderKindFilter === "shortage" && o.isShortageOrder !== true) return false;
      if (orderKindFilter === "standard" && o.isShortageOrder === true) return false;
      if (!q) return true;
      const hay = [
        o.supplier,
        o.supplierContact,
        o.job?.jobNumber,
        o.job?.customerName,
        labelMaterialType(o.materialType),
        o.deliveryStatus,
        o.isShortageOrder ? "porudžbina po nedostatku porudzbina po nedostatku shortage" : "standardna porudžbina",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [displayOrdersAll, statusFilter, paymentFilter, materialFilter, orderKindFilter, searchQuery]);
  const shortageOrdersByParent = useMemo(() => {
    const map = new Map<string, MaterialOrder[]>();
    for (const o of displayOrdersAll) {
      const parentId = o.parentOrderId?.trim();
      if (!o.isShortageOrder || !parentId) continue;
      const list = map.get(parentId) ?? [];
      list.push(o);
      map.set(parentId, list);
    }
    return map;
  }, [displayOrdersAll]);
  const isLoading = !initialOrders && ordersLoading;

  const orderIds = displayOrdersAll.map((o) => o.id);
  const { data: attachmentsByOrder = {}, isLoading: attachmentsLoading } = useMaterialOrderAttachments(orderIds);

  // Reklamacije se kreiraju tek na finalize-u prijema, ali ih dohvatamo za sve narudžbine
  // kako bi se upozorenje pojavilo i kada se delivery_status iz nekog razloga menja
  // (npr. povratak u waiting_for_delivery zbog zamene od dobavljača).
  const { data: allComplaints = [], isLoading: allComplaintsLoading } = useProcurementComplaintsForOrderIds(
    orderIds,
    orderIds.length > 0,
  );
  const complaintsByOrderId = useMemo(() => {
    const map: Record<string, ProcurementComplaintWithOrder[]> = {};
    for (const c of allComplaints) {
      if (!map[c.order_id]) map[c.order_id] = [];
      map[c.order_id].push(c);
    }
    return map;
  }, [allComplaints]);

  const { data: adHocByOrderId = {} } = useProcurementAdHocItemsForOrderIds(
    orderIds,
    orderIds.length > 0,
  );

  const handleCreate = (data: MaterialOrderFormValues & Record<string, unknown>) => {
    createOrder.mutate(data as Omit<MaterialOrder, "id">, {
      onSuccess: (inserted) => {
        setIsModalOpen(false);
        const orderId = String((inserted as { id?: string })?.id ?? "");
        if (!orderId || !user?.id) return;
        const orderForPdf = {
          ...(data as MaterialOrder),
          id: orderId,
        } as MaterialOrder;
        setPendingAutoPdfOrderIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
        void exportMaterialOrderPDF(orderForPdf, {
          attachGeneratedPdf: true,
          openInBrowser: false,
          userId: user.id,
          onPdfAttached: () => {
            setPendingAutoPdfOrderIds((prev) => prev.filter((id) => id !== orderId));
            void queryClient.invalidateQueries({ queryKey: ["material-order-files"] });
            if (orderForPdf.jobId) void queryClient.invalidateQueries({ queryKey: ["files", orderForPdf.jobId] });
          },
          onPdfAttachFailed: (msg) => {
            setPendingAutoPdfOrderIds((prev) => prev.filter((id) => id !== orderId));
            toast.error("PDF porudžbine nije sačuvan u priloge", { description: msg });
          },
        }).catch((e) => {
          setPendingAutoPdfOrderIds((prev) => prev.filter((id) => id !== orderId));
          toast.error("Generisanje PDF priloga nije uspelo", {
            description: e instanceof Error ? e.message : "Nepoznata greška.",
          });
        });
      },
    });
  };


  const handleUpdate = (data: MaterialOrderFormValues & Record<string, unknown>) => {
    if (!editingOrder) return;
    const merged = mergeDefined(editingOrder, data) as MaterialOrder;
    updateOrder.mutate(merged, {
      onSuccess: () => {
        setIsModalOpen(false);
        setEditingOrder(null);
      },
    });
  };

  const handleDelete = (id: string) => {
    deleteOrder.mutate(id);
  };

  const openEdit = (order: MaterialOrder) => {
    setEditingOrder(order);
    setIsModalOpen(true);
  };

  const openCreate = () => {
    setEditingOrder(null);
    setIsModalOpen(true);
  };

  const openAttachmentPicker = (order: MaterialOrder) => {
    if (!canPerformAction("upload_file")) return;
    if (!user) {
      toast.error("Morate biti prijavljeni");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";

    input.onchange = async (event) => {
      const selectedFile = (event.target as HTMLInputElement).files?.[0];
      if (!selectedFile) return;

      try {
        await uploadFile.mutateAsync({
          materialOrderId: order.id,
          jobId: order.jobId || jobId,
          category: "supplier",
          file: selectedFile,
          uploadedBy: user.id,
        });
      } catch {
        // useFiles prikazuje grešku
      }
    };

    input.click();
  };

  const handleDeleteAttachment = (file: AppFile) => {
    deleteFile.mutate(file.id);
  };

  const markMaterialDelivered = (o: MaterialOrder) => {
    const today = new Date().toISOString().slice(0, 10);
    updateOrder.mutate(
      mergeDefined(o, {
        deliveryStatus: "delivered" as const,
        deliveryDate: today,
        deliveryVerified: true,
      }) as MaterialOrder,
    );
  };

  const canMarkMaterialOrderPaid = () =>
    canPerformAction("record_payment") && (currentRole === "admin" || currentRole === "finance");

  const handleExportPdf = async (order: MaterialOrder) => {
    setPdfExportOrderId(order.id);
    try {
      await exportMaterialOrderPDF(order, {
        attachGeneratedPdf: !!user?.id,
        userId: user?.id,
        onPdfAttached: (result) => {
          queryClient.invalidateQueries({ queryKey: ["material-order-files"] });
          if (order.jobId) void queryClient.invalidateQueries({ queryKey: ["files", order.jobId] });
          void queryClient.invalidateQueries({ queryKey: ["files", "all"] });
          invalidateFilesStorageUsage(queryClient);
          if (result === "updated") {
            toast.success("PDF narudžbine je ažuriran u prilozima");
          } else {
            toast.success("PDF narudžbine je sačuvan u priloge");
          }
        },
        onPdfAttachFailed: (_m) =>
          toast.error("Štampa je otvorena, ali PDF nije sačuvan kao prilog. Proverite internet i pokušajte ponovo."),
      });
      if (!user?.id) {
        toast.success("PDF porudžbine je generisan (novi tab ili preuzimanje).");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Greška pri generisanju dokumenta za štampu";
      toast.error("Štampa PDF-a nije moguća", { description: msg });
    } finally {
      setPdfExportOrderId(null);
    }
  };

  const buildSupplierOrderEmailSubject = (order: MaterialOrder): string => {
    return "Porudzbina materijala Termo Plast D.O.O";
  };

  const renderOrderCard = (o: MaterialOrder) => {
    const relatedJob = o.job;
    const attachments = attachmentsByOrder[o.id] ?? [];
    const isAutoPdfPending = pendingAutoPdfOrderIds.includes(o.id);
    const fromLines = o.nbLines && o.nbLines.length > 0 ? sumOrderLinesNet(o.nbLines) : 0;
    const headerNet = Number(o.price ?? o.supplierPrice ?? 0) || 0;
    const cardPrice =
      o.isShortageOrder && !o.siteMissingFromInstallation ? 0 : fromLines > 0 ? fromLines : headerNet;
    const canCreate = canPerformAction("create_order");
    const ownComplaints = complaintsByOrderId[o.id] ?? [];
    /** Reklamacije su u bazi uvek vezane za parent. Shortage kartica ih prikazuje preko `parentOrderId`,
     *  parent kartica preko sopstvenog `o.id`. */
    const orderComplaints = o.isShortageOrder && o.parentOrderId
      ? complaintsByOrderId[o.parentOrderId] ?? []
      : ownComplaints;
    const complaintModalTargetId = o.isShortageOrder ? (o.parentOrderId ?? o.id) : o.id;
    const activeComplaints = orderComplaints.filter((c) => isProcurementComplaintActive(c.status));
    const childShortageOrders = shortageOrdersByParent.get(o.id) ?? [];
    const activeChildShortageOrders = childShortageOrders.filter(isActiveShortageOrder);
    const hasActiveShortageChild = activeChildShortageOrders.length > 0;
    /** Čim postoji bilo koja Porudžbina po nedostatku (aktivna ili zatvorena), ad-hoc
     *  stavke se vode na njoj — parent ne prikazuje sekciju ni postojeće stavke. */
    const hasAnyShortageChild = childShortageOrders.length > 0;
    /** Efektivna lista vanrednih stavki za karticu:
     *  - parent sa shortage child: ništa (ad-hoc se vodi na shortage)
     *  - shortage (klasična nadoknada): svoje + parent (vidljivost stavki pre shortage child-a)
     *  - shortage hitno sa ugradnje: samo sopstvene (linije su na `nb_lines`, ne nasleđuj parent ad-hoc)
     *  - parent bez shortage child: svoje stavke. */
    const cardOrderLines = normalizeOrderLines(o);
    const orderAdHocList = (() => {
      if (!o.isShortageOrder && hasAnyShortageChild) return [] as ProcurementAdHocItem[];
      if (o.isShortageOrder && o.parentOrderId) {
        if (o.siteMissingFromInstallation) {
          return adHocByOrderId[o.id] ?? [];
        }
        const own = adHocByOrderId[o.id] ?? [];
        const parent = adHocByOrderId[o.parentOrderId] ?? [];
        const seen = new Set<string>();
        const combined: ProcurementAdHocItem[] = [];
        for (const it of [...own, ...parent]) {
          if (!seen.has(it.id)) {
            seen.add(it.id);
            combined.push(it);
          }
        }
        return combined;
      }
      return adHocByOrderId[o.id] ?? [];
    })();
    const pendingAdHocItems = orderAdHocList.filter((it) => isProcurementAdHocActive(it.status));
    const af = materialOrderCardActionFlags(o, canCreate, canMarkMaterialOrderPaid(), {
      pendingAdHocCount: pendingAdHocItems.length,
      nbLineCount: cardOrderLines.length,
    });
    /** Aktivni rad sa reklamacijama: na parent kartici sakriven dok postoji shortage child;
     *  na shortage kartici uvek vidljiv (jer je tu sada aktivni task). */
    const showComplaintAlert = o.isShortageOrder
      ? activeComplaints.length > 0
      : activeComplaints.length > 0 && !hasActiveShortageChild;
    const hasPendingAdHoc = pendingAdHocItems.length > 0;
    const hasIssueAlert = showComplaintAlert || hasPendingAdHoc;
    const hasReportedIssue =
      showComplaintAlert &&
      activeComplaints.some((c) => procurementComplaintBadgeVariant(c.status) === "danger");
    const hasAwaitingDelivery = !hasReportedIssue && showComplaintAlert;
    const shortageReadyForReception =
      o.isShortageOrder &&
      activeComplaints.some(
        (c) => normalizeProcurementComplaintStatus(c.status) === PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY,
      );
    /** Refund stanje shortage porudžbine: računa se preko reklamacija povezanih sa njenim linijama
     *  (`shortageSource.complaintId`). Ako su sve refundirane → „Refundirano"; ako su pomešane
     *  (deo refund / deo primljen) → „Delimično refundirano"; inače standardno „Nadoknada primljena". */
    const shortageLinkedComplaintIds = o.isShortageOrder
      ? new Set(
          cardOrderLines
            .map((l) => l.shortageSource?.complaintId)
            .filter((v): v is string => typeof v === "string" && v.length > 0),
        )
      : new Set<string>();
    const shortageLinkedComplaints = o.isShortageOrder
      ? orderComplaints.filter((c) => shortageLinkedComplaintIds.has(c.id))
      : [];
    const shortageRefundedCount = shortageLinkedComplaints.filter(
      (c) => normalizeProcurementComplaintStatus(c.status) === PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED,
    ).length;
    const shortageResolvedCount = shortageLinkedComplaints.filter(
      (c) => normalizeProcurementComplaintStatus(c.status) === PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED,
    ).length;
    const shortageTotalLinked = shortageLinkedComplaints.length;
    const isShortageFullyRefunded =
      shortageTotalLinked > 0 && shortageRefundedCount === shortageTotalLinked;
    const isShortagePartiallyRefunded =
      shortageTotalLinked > 0 && shortageRefundedCount > 0 && shortageResolvedCount > 0;
    const isReceptionExpanded = expandedReceptionOrderId === o.id;
    const isAdmin = currentRole === "admin";
    const showReceptionDetails =
      isAdmin &&
      (o.deliveryStatus === "materials_received" ||
        o.deliveryStatus === "received_with_issues" ||
        o.isShortageOrder === true);
    const showSiteHitNbLinesSection = Boolean(o.siteMissingFromInstallation && cardOrderLines.length > 0);
    const showProcurementAdHocOnCard =
      !o.siteMissingFromInstallation || cardOrderLines.length === 0 || orderAdHocList.length > 0;
    return (
      <div key={o.id} className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:shadow-sm transition-shadow">
        {hasIssueAlert && !allComplaintsLoading ? (
          <Alert
            variant={hasReportedIssue || hasPendingAdHoc ? "destructive" : "default"}
            className={
              hasReportedIssue || hasPendingAdHoc
                ? "mb-4 border-destructive/70 bg-destructive/10"
                : "mb-4 border-amber-500/55 bg-amber-500/10 text-foreground dark:border-amber-500/45 dark:bg-amber-500/10"
            }
          >
            <AlertTriangle
              className={`h-4 w-4 ${hasReportedIssue || hasPendingAdHoc ? "" : "text-amber-700 dark:text-amber-400"}`}
            />
            <AlertTitle
              className={hasReportedIssue || hasPendingAdHoc ? undefined : "text-amber-950 dark:text-amber-100"}
            >
              {hasReportedIssue
                ? "Isporuka sa nedostatkom / oštećenjem"
                : hasPendingAdHoc && !showComplaintAlert
                  ? "Vanredne stavke čekaju prijem"
                  : "Reklamacije — u rešavanju / čeka se dostava"}
            </AlertTitle>
            <AlertDescription
              className={`mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
                hasReportedIssue || hasPendingAdHoc ? "" : "text-amber-950/90 dark:text-amber-50/90"
              }`}
            >
              <span>
                {[
                  showComplaintAlert
                    ? hasAwaitingDelivery
                      ? `${activeComplaints.length} ${
                          activeComplaints.length === 1 ? "reklamacija je" : "reklamacije su"
                        } u rešavanju (magacin prima skeniranjem barkoda iz PDF-a)`
                      : `${activeComplaints.length} ${
                          activeComplaints.length === 1 ? "stavka je prijavljena" : "stavke su prijavljene"
                        } kao nedostatak ili oštećenje — pošaljite PDF nabavci`
                    : null,
                  hasPendingAdHoc
                    ? `${pendingAdHocItems.length} ${
                        pendingAdHocItems.length === 1 ? "vanredna stavka čeka" : "vanredne stavke čekaju"
                      } prijem`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" • ")}
                .
              </span>
              {showComplaintAlert ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={`w-fit shrink-0 ${
                    hasReportedIssue || hasPendingAdHoc ? "" : "border-amber-600/30 bg-background/80 hover:bg-background"
                  }`}
                  onClick={() => setComplaintModalOrderId(complaintModalTargetId)}
                >
                  Rešavaj problem
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {!o.isShortageOrder && childShortageOrders.length > 0 ? (
          <Alert className="mb-4 border-amber-500/55 bg-amber-500/10 text-foreground dark:border-amber-500/45 dark:bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            <AlertTitle className="text-amber-950 dark:text-amber-100">
              {activeChildShortageOrders.length > 0
                ? "Postoji Porudžbina po nedostatku za ovu narudžbinu"
                : "Porudžbina po nedostatku — zatvorena"}
            </AlertTitle>
            <AlertDescription className="mt-2 text-amber-950/90 dark:text-amber-50/90">
              {activeChildShortageOrders.length > 0
                ? `Nedostajuće ili oštećene stavke prebačene su u posebnu Porudžbinu po nedostatku gde se prati nadoknada od dobavljača (${activeChildShortageOrders.length} ${
                    activeChildShortageOrders.length === 1 ? "aktivna" : "aktivne"
                  }${childShortageOrders.length > activeChildShortageOrders.length ? `, ${childShortageOrders.length - activeChildShortageOrders.length} zatvorena` : ""}).`
                : `Sve Porudžbine po nedostatku za ovu narudžbinu su zatvorene (${childShortageOrders.length} ukupno).`}
            </AlertDescription>
          </Alert>
        ) : null}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                       <p className="font-medium text-foreground text-sm">{labelMaterialType(o.materialType)}</p>
                       <div className="flex items-center gap-2 text-xs text-muted-foreground">
                         <button
                           type="button"
                           className="text-primary hover:underline font-medium flex items-center gap-1"
                           onClick={() => setViewSupplier({
                             name: o.supplier,
                             contact: o.supplierContact,
                             phone: o.supplierPhone || "",
                             address: o.supplierAddress || "",
                             bankAccount: o.supplierBankAccount,
                             pib: o.supplierPib,
                             category: o.materialType,
                           })}
                         >
                           <Building2 className="w-3 h-3" />
                           {o.supplier}
                         </button>
                         {relatedJob && !jobId ? (
                           <JobCustomerLink
                             jobId={relatedJob.id}
                             jobNumber={relatedJob.jobNumber}
                             customerName={relatedJob.customerName}
                             returnState={jobListReturn}
                           />
                         ) : null}
                       </div>
                     </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {o.isShortageOrder ? (
                      <>
                        {o.deliveryStatus === "materials_received" ? (
                          isShortageFullyRefunded ? (
                            <GenericBadge label="Refundirano" variant="muted" />
                          ) : isShortagePartiallyRefunded ? (
                            <GenericBadge label="Delimično refundirano" variant="muted" />
                          ) : (
                            <GenericBadge label="Nadoknada primljena" variant="success" />
                          )
                        ) : isShortageFullyRefunded ? (
                          <GenericBadge label="Refundirano" variant="muted" />
                        ) : (
                          <GenericBadge label="Čeka nadoknadu" variant="warning" />
                        )}
                        <GenericBadge label="Porudžbina po nedostatku" variant="warning" />
                        {o.siteMissingFromInstallation ? (
                          <GenericBadge label="Hitno sa ugradnje" variant="destructive" />
                        ) : null}
                      </>
                    ) : (
                      <GenericBadge
                        label={materialOrderDeliveryLabel(o)}
                        variant={deliveryVariant[o.deliveryStatus] ?? "muted"}
                      />
                    )}
                    {o.isShortageOrder && !o.siteMissingFromInstallation ? (
                      <GenericBadge label="Bez novog plaćanja" variant="muted" />
                    ) : !o.isShortageOrder || o.siteMissingFromInstallation ? (
                      <>
                        <GenericBadge label={o.paid ? "Plaćeno" : "Neplaćeno"} variant={o.paid ? "success" : "danger"} />
                        {o.paymentStatus === "paid_advance" ? (
                          <GenericBadge label="Avans (faktura)" variant="success" />
                        ) : null}
                        {o.invoiceFileUrl || o.invoiceNumber ? (
                          <GenericBadge label="Faktura zabeležena" variant="info" />
                        ) : null}
                        {o.sefReconciliationAt ? (
                          <GenericBadge label="SEF (legacy)" variant="muted" />
                        ) : null}
                      </>
                    ) : null}
                    <DelayedDeliveryBadge order={o} />
                    <div className="flex items-center gap-1 ml-2">
                      {af.showPrinter ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={pdfExportOrderId === o.id}
                          title="PDF / štampa (jedan prilog po narudžbini — ažurira se pri ponovnoj štampi)"
                          onClick={() => void handleExportPdf(o)}
                        >
                          {pdfExportOrderId === o.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Printer className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      ) : null}
                      {canCreate ? (
                        <>
                          {!o.isShortageOrder || o.siteMissingFromInstallation ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Izmena narudžbine" onClick={() => openEdit(o)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          ) : null}
                          <ConfirmDialog
                            title="Obrisati narudžbinu?"
                            description="Da li ste sigurni da želite da obrišete ovu narudžbinu? Ova akcija je nepovratna."
                            confirmLabel="Obriši"
                            cancelLabel="Otkaži"
                            onConfirm={() => handleDelete(o.id)}
                            trigger={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                title="Obriši narudžbinu"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Upit / Naručeno</span>
                    <p className="font-medium">
                      {formatMaterialOrderDateForDisplay(o.requestDate || o.orderDate) || "—"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Očekivano</span>
                    <p className="font-medium">{formatMaterialOrderDateForDisplay(o.expectedDelivery) || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">
                      {o.isShortageOrder && !o.siteMissingFromInstallation ? "Novi trošak" : "Cena"}
                    </span>
                    <p className="font-medium">
                      {o.isShortageOrder && !o.siteMissingFromInstallation
                        ? "0 RSD"
                        : formatCurrency(cardPrice)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Kontakt</span>
                    <p className="font-medium text-xs sm:text-sm">{o.supplierContact}</p>
                  </div>
                </div>

                {o.supplierProformaUrl && (!o.isShortageOrder || o.siteMissingFromInstallation) ? (
                  <p className="mt-2 text-xs">
                    <a
                      href={o.supplierProformaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary font-medium hover:underline"
                    >
                      Predračun dobavljača (otvori link)
                    </a>
                  </p>
                ) : null}

                {o.deliveryStatus === "sent_to_supplier" && canPerformAction("upload_file") ? (
                  <div className="mt-3">
                    <MaterialOrderSupplierProformaForm
                      order={o}
                      disabled={updateOrder.isPending}
                      onSaved={async (next) => {
                        await updateOrder.mutateAsync(next);
                      }}
                    />
                  </div>
                ) : null}

                {(() => {
                  const hasPendingFollowup = (showComplaintAlert && activeChildShortageOrders.length === 0) || hasPendingAdHoc;
                  // Pristup magacinu (skener) je dostupan na svim narudžbinama gde postoje
                  // pending reklamacije ili vanredne stavke, bez obzira na trenutni delivery_status.
                  // Kada je manjak/oštećenje prebačeno u shortage porudžbinu, prijem ide tamo,
                  // ne na parentu (parent ostaje istorija i audit).
                  const showFollowupReception = hasPendingFollowup;
                  if (!af.showWorkflowRow && !showFollowupReception) return null;
                  /** Na shortage kartici dugme za prijem se otključava tek kada reklamacija pređe u
                   *  „U rešavanju / Čeka se dostava” — pre toga nabavka još gura dobavljača. */
                  const receptionAllowedForShortage =
                    !o.isShortageOrder ||
                    o.siteMissingFromInstallation ||
                    shortageReadyForReception;
                  const showReceptionButton =
                    receptionAllowedForShortage && (af.showReceptionBarcode || showFollowupReception);
                  return (
                    <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {showReceptionButton ? (
                          <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                            <Link to={`/order-reception/${o.id}`}>
                              <ScanBarcode className="w-3.5 h-3.5" />
                              {showFollowupReception && !af.showReceptionBarcode
                                ? "Prijem (reklamacije / vanredno)"
                                : "Prijem (barkod)"}
                            </Link>
                          </Button>
                        ) : null}
                      {af.showMail ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5"
                          onClick={() => setSupplierOrderModalOrder(o)}
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Pošalji porudžbinu dobavljaču
                        </Button>
                      ) : null}
                        {af.showMarkPaidWorkflow ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1.5"
                            onClick={() => setPaymentStepOrder(o)}
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            Plaćeno + rok isporuke
                          </Button>
                        ) : null}
                        {af.showInvoiceEvidencija ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1.5"
                            onClick={() => setInvoiceDialogOrder(o)}
                          >
                            <FileSearch2 className="w-3.5 h-3.5" />
                            Faktura / plaćanje
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}

                {o.supplierComplaintNote?.trim() ? (
                  <p className="text-xs text-muted-foreground mt-2 border-l-2 border-amber-500/60 pl-2">
                    <span className="font-medium text-foreground">Reklamacija (sačuvano):</span>{" "}
                    {o.supplierComplaintNote.length > 200
                      ? `${o.supplierComplaintNote.slice(0, 200)}…`
                      : o.supplierComplaintNote}
                  </p>
                ) : null}

                <div className="mt-4 border-t border-border pt-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prilozi</p>
                    {canPerformAction("upload_file") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => openAttachmentPicker(o)}
                        disabled={uploadFile.isPending}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Dodaj fajl
                      </Button>
                    )}
                  </div>
                  {attachmentsLoading ? (
                    <p className="text-xs text-muted-foreground">Učitavanje priloga…</p>
                  ) : isAutoPdfPending ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      PDF porudžbenice se priprema i biće automatski dodat u priloge…
                    </p>
                  ) : attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nema priloženih fajlova. Štampom se jednom doda isti PDF porudžbine (memorandum, stavke, barkodovi, bez
                      cena; ime fajla po poslu i narudžbini); ponovna štampa ga samo ažurira.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {attachments.map((f) => {
                        const n = f.name.toLowerCase();
                        const isGenPdf =
                          n.endsWith(".pdf") && (n.includes("porudzbenica_") || n.includes("narudzbina-materijala"));
                        return (
                          <li key={f.id} className="flex items-center justify-between gap-2 text-sm group">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                              {f.storageUrl ? (
                                <a
                                  href={f.storageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline truncate flex items-center gap-1"
                                >
                                  <span className="truncate">{f.name}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                                </a>
                              ) : (
                                <span className="truncate">{f.name}</span>
                              )}
                              {isGenPdf && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium shrink-0">
                                  generisano
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground shrink-0">{f.size}</span>
                            </div>
                            {canPerformAction("upload_file") && (
                              <ConfirmDialog
                                trigger={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                    disabled={deleteFile.isPending}
                                    aria-label="Obriši prilog"
                                  >
                                    {deleteFile.isPending ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                }
                                title="Obrisati prilog?"
                                description={`„${f.name}” će biti uklonjen iz priloga i sa skladišta. Ova radnja se ne može poništiti.`}
                                confirmLabel="Obriši prilog"
                                cancelLabel="Otkaži"
                                onConfirm={() => handleDeleteAttachment(f)}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(o.requestFile || o.quoteFile) && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-dashed border-border mt-2">
                      Stari zapis (tekst): {o.requestFile ? `upit «${o.requestFile}»` : ""}
                      {o.requestFile && o.quoteFile ? " · " : ""}
                      {o.quoteFile ? `ponuda «${o.quoteFile}»` : ""}
                    </p>
                  )}
                </div>

                {!o.isShortageOrder && hasAnyShortageChild ? (
                  <div className="mt-4 border-t border-border pt-3">
                    <p className="text-[11px] text-muted-foreground italic">
                      Vanredne stavke za ovu narudžbinu se dodaju na Porudžbini po nedostatku.
                    </p>
                  </div>
                ) : (
                  <>
                    {showSiteHitNbLinesSection ? (
                      <div className="mt-4 border-t border-border pt-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Stavke ove porudžbine
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Hitna porudžbina po nedostatku — stavke iz forme / PDF-a (ne nasleđuju se vanredne stavke sa
                          roditeljske narudžbine).
                        </p>
                        <ul className="rounded-md border border-border bg-muted/20 divide-y divide-border text-xs">
                          {cardOrderLines.map((line, idx) => (
                            <li
                              key={idx}
                              className="px-2.5 py-2 flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground">{line.description}</p>
                                {line.procurementMeta?.article_code ? (
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    {line.procurementMeta.article_code}
                                  </p>
                                ) : null}
                                {line.procurementMeta?.position ? (
                                  <p className="text-[10px] text-muted-foreground">
                                    Pozicija: {line.procurementMeta.position}
                                  </p>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-right sm:text-left flex flex-row sm:flex-col gap-2 sm:gap-0.5">
                                <span className="text-muted-foreground">
                                  {line.quantity} {line.unit}
                                </span>
                                <span className="font-medium tabular-nums">{formatCurrency(line.lineNet)}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {showProcurementAdHocOnCard ? (
                      <ProcurementAdHocSection
                        order={o}
                        items={orderAdHocList}
                        canManage={canCreate}
                        onAdd={() => setAdHocOrder(o)}
                        onToggleStatus={(item, status) =>
                          updateAdHocStatus.mutate({ id: item.id, status })
                        }
                        onDelete={(item) => deleteAdHocItem.mutate(item.id)}
                        isMutating={updateAdHocStatus.isPending || deleteAdHocItem.isPending}
                      />
                    ) : null}
                  </>
                )}

                {o.notes && <p className="text-sm text-muted-foreground mt-3 border-t border-border pt-3">{o.notes}</p>}

                {showReceptionDetails && (
                  <div className="mt-4 border-t border-border pt-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs gap-1.5 w-full justify-between"
                      onClick={() => setExpandedReceptionOrderId(isReceptionExpanded ? null : o.id)}
                    >
                      <span className="flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5" />
                        Detalji prijema
                      </span>
                      {isReceptionExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>

                    {isReceptionExpanded && orderComplaints.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {orderComplaints.map((complaint) => {
                          const details = (complaint.item_details && typeof complaint.item_details === "object" ? complaint.item_details : {}) as Record<string, unknown>;
                          const missingQty = details.missing_qty as number | undefined;
                          const damagedQty = details.damaged_qty as number | undefined;
                          const notes = details.notes as string | undefined;
                          const article = details.article as string | undefined;
                          const articleCode = details.article_code as string | undefined;
                          const hasIssues = (missingQty && missingQty > 0) || (damagedQty && damagedQty > 0);
                          const isActive = isProcurementComplaintActive(complaint.status);

                          return (
                            <div key={complaint.id} className={`rounded-lg border p-3 ${isActive ? "border-border bg-muted/30" : "border-green-500/20 bg-green-50/30 dark:bg-green-950/10"}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {articleCode && (
                                      <span className="font-mono text-xs text-muted-foreground">{articleCode}</span>
                                    )}
                                    {article && (
                                      <span className="font-medium text-sm">{article}</span>
                                    )}
                                    <GenericBadge
                                      label={labelProcurementComplaintStatus(complaint.status)}
                                      variant={procurementComplaintBadgeVariant(complaint.status)}
                                    />
                                    {complaint.barcode ? (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                                        {complaint.barcode}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                                    {missingQty && missingQty > 0 && (
                                      <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                                        <span className="font-medium">Nedostaje:</span> {missingQty}
                                      </span>
                                    )}
                                    {damagedQty && damagedQty > 0 && (
                                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                        <span className="font-medium">Oštećeno:</span> {damagedQty}
                                      </span>
                                    )}
                                    {!hasIssues && (
                                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                        <CheckCircle className="w-3 h-3" /> Ispravno
                                      </span>
                                    )}
                                  </div>
                                  {notes?.trim() && (
                                    <p className="mt-2 text-xs text-muted-foreground border-l-2 border-muted-foreground/30 pl-2 italic">
                                      "{notes.trim()}"
                                    </p>
                                  )}
                                </div>
                              </div>
                              {complaint.photo_evidence_urls && complaint.photo_evidence_urls.length > 0 && (
                                <div className="mt-3 flex gap-2 flex-wrap">
                                  {complaint.photo_evidence_urls.map((url, idx) => (
                                    <a
                                      key={idx}
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block h-16 w-16 rounded-md overflow-hidden border border-border hover:ring-2 hover:ring-primary transition-all shrink-0"
                                    >
                                      <img src={url} alt={`Foto ${idx + 1}`} className="h-full w-full object-cover" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isReceptionExpanded && orderComplaints.length === 0 && (
                      <div className="mt-3 rounded-lg border border-green-500/30 bg-green-50/50 dark:bg-green-950/20 p-3">
                        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                          <CheckCircle className="w-4 h-4" />
                          <span className="font-medium">Sve stavke su primljene ispravno</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Nema zabeleženih neslaganja na prijemu.</p>
                      </div>
                    )}
                  </div>
                )}
                {o.barcode ? (
                  <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                    Barkod: {o.barcode}
                  </div>
                ) : null}
      </div>
    );
  };

  const emptyProcurementDescription = "Nema evidentiranih narudžbina za trenutne filtere ili posao.";

  return (
    <div>
      {showUrgentSiteMissingOnJob && urgentRowsForJob.length > 0 && jobId ? (
        <div className="mb-4">
          <DashboardUrgentPredracunAlert
            rows={urgentRowsForJob}
            hasAccess={hasAccess}
            canSecureInvoiceMissingPart={canSecureInvoiceMissingPart}
            canConfirmInvoiceMissingProduction={canConfirmInvoiceMissingProduction}
            actionPending={actionPendingUrgent}
            onSecurePart={(a) => secureInvoiceMissing.mutateAsync(a)}
            onConfirmProduction={(a) => confirmInvoiceMissingProduction.mutateAsync(a)}
            onOpenProslediNabavku={(a) => setUrgentProcurementDialog({ jobId: a.jobId, position: a.position })}
          />
        </div>
      ) : null}
      <SectionHeader
        title="Narudžbine materijala"
        subtitle={`${displayOrders.length}/${displayOrdersAll.length} narudžbin${displayOrders.length === 1 ? "a" : "e"}`}
        icon={Package}
        actions={
          canPerformAction("create_order") ? (
            <Button size="sm" type="button" onClick={openCreate}>
              Nova narudžbina
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Pretraga dobavljača, posla..."
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi statusi</SelectItem>
            {deliveryStatusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {deliveryLabels[status] ?? status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentFilter} onValueChange={setPaymentFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Plaćanje" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sva plaćanja</SelectItem>
            <SelectItem value="paid">Plaćeno</SelectItem>
            <SelectItem value="unpaid">Neplaćeno</SelectItem>
          </SelectContent>
        </Select>
        <Select value={orderKindFilter} onValueChange={setOrderKindFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Tip narudžbine" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Svi tipovi</SelectItem>
            <SelectItem value="standard">Standardne narudžbine</SelectItem>
            <SelectItem value="shortage">Porudžbine po nedostatku</SelectItem>
          </SelectContent>
        </Select>
        <Select value={materialFilter} onValueChange={setMaterialFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Vrsta materijala" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sve vrste materijala</SelectItem>
            {materialTypeOptions.map((mt) => (
              <SelectItem key={mt} value={mt}>
                {labelMaterialType(mt as any)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <CardListSkeleton count={3} />
      ) : displayOrders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nema narudžbina materijala"
          description={emptyProcurementDescription}
          actionLabel={canPerformAction("create_order") ? "Nova narudžbina" : undefined}
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-4">{displayOrders.map((o) => renderOrderCard(o))}</div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="w-full sm:max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Izmena narudžbine" : "Nova narudžbina"}</DialogTitle>
          </DialogHeader>
          <MaterialOrderForm
            key={editingOrder?.id ?? "new"}
            jobId={jobId}
            initialData={editingOrder || {}}
            onSubmit={editingOrder ? handleUpdate : handleCreate}
            onCancel={() => setIsModalOpen(false)}
            isLoading={createOrder.isPending || updateOrder.isPending}
          />
        </DialogContent>
      </Dialog>

      <MaterialOrderInvoiceEvidencijaDialog
        order={invoiceDialogOrder}
        open={invoiceDialogOrder !== null}
        onOpenChange={(open) => {
          if (!open) setInvoiceDialogOrder(null);
        }}
        jobId={jobId}
        userId={user?.id}
        canUpload={canPerformAction("upload_file")}
        uploadFile={uploadFile}
        onPersist={async (next) => {
          await updateOrder.mutateAsync(next);
          setInvoiceDialogOrder(next);
        }}
        isSaving={updateOrder.isPending}
        onFilesChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["material-order-files"] });
        }}
      />

      <MaterialOrderPaymentStepDialog
        order={paymentStepOrder}
        open={paymentStepOrder !== null}
        onOpenChange={(open) => {
          if (!open) setPaymentStepOrder(null);
        }}
        isSaving={updateOrder.isPending}
        onPersist={async (next) => {
          await updateOrder.mutateAsync(next);
          setPaymentStepOrder(null);
        }}
      />

      <InvoiceMissingShortageOrderModal
        open={!!urgentProcurementDialog}
        onOpenChange={(open) => {
          if (!open) setUrgentProcurementDialog(null);
        }}
        jobId={urgentProcurementDialog?.jobId ?? ""}
        position={urgentProcurementDialog?.position ?? ""}
        sendMutation={sendInvoiceMissingToProcurement}
      />

      <SupplierOrderModal
        open={supplierOrderModalOrder !== null}
        onOpenChange={(open) => {
          if (!open) setSupplierOrderModalOrder(null);
        }}
        recipientEmail={supplierOrderModalOrder?.supplierEmail?.trim() || "Nije unet email dobavljača"}
        defaultSubject={
          supplierOrderModalOrder
            ? buildSupplierOrderEmailSubject(supplierOrderModalOrder)
            : "Porudzbina materijala"
        }
        isSending={supplierEmailSending}
        onDownloadDocument={async () => {
          if (!supplierOrderModalOrder) return;
          await handleExportPdf(supplierOrderModalOrder);
        }}
        onSendEmail={async ({ subject, message, signature }) => {
          if (!supplierOrderModalOrder) return;
          setSupplierEmailSending(true);
          try {
            const res = await sendMaterialOrderEmailToSupplier({
              orderId: supplierOrderModalOrder.id,
              subject,
              message,
              signature,
            });
            if (!res.ok) {
              throw new Error(res.error || "Slanje nije uspelo.");
            }
            const next = mergeDefined(supplierOrderModalOrder, {
              deliveryStatus: "sent_to_supplier" as const,
            }) as MaterialOrder;
            await updateOrder.mutateAsync(next);
            setSupplierOrderModalOrder(null);
            void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
            void queryClient.invalidateQueries({ queryKey: ["activities"] });
          } finally {
            setSupplierEmailSending(false);
          }
        }}
      />

      <ProcurementDiscrepancyModal
        open={complaintModalOrderId !== null}
        onOpenChange={(open) => {
          if (!open) setComplaintModalOrderId(null);
        }}
        complaints={complaintModalOrderId ? (complaintsByOrderId[complaintModalOrderId] ?? []) : []}
      />

      <Dialog open={viewSupplier !== null} onOpenChange={() => setViewSupplier(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              Detalji dobavljača
            </DialogTitle>
          </DialogHeader>
          {viewSupplier && (
            <div className="space-y-4 py-2">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground">Naziv dobavljača</h4>
                <p className="text-base font-semibold">{viewSupplier.name}</p>
              </div>
              {viewSupplier.category && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Kategorija</h4>
                  <p className="text-sm">{labelSupplierCategoryForDisplay(viewSupplier.category)}</p>
                </div>
              )}
              {viewSupplier.contact && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Kontakt osoba</h4>
                  <p className="text-sm">{viewSupplier.contact}</p>
                </div>
              )}
              {viewSupplier.phone && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Telefon</h4>
                  <p className="text-sm">{viewSupplier.phone}</p>
                </div>
              )}
              {viewSupplier.address && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Adresa</h4>
                  <p className="text-sm">{viewSupplier.address}</p>
                </div>
              )}
              {viewSupplier.bankAccount && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Žiro / tekući račun</h4>
                  <p className="text-sm font-mono">{viewSupplier.bankAccount}</p>
                </div>
              )}
              {viewSupplier.pib && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">PIB</h4>
                  <p className="text-sm font-mono">{viewSupplier.pib}</p>
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-border">
                <Button variant="outline" size="sm" onClick={() => setViewSupplier(null)}>
                  <X className="w-4 h-4 mr-1" />
                  Zatvori
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {adHocOrder && user ? (
        <ProcurementAdHocItemModal
          open={Boolean(adHocOrder)}
          onOpenChange={(v) => {
            if (!v) setAdHocOrder(null);
          }}
          orderId={adHocOrder.id}
          jobId={adHocOrder.jobId ?? jobId ?? null}
          uploadedBy={user.id}
          supplierLabel={adHocOrder.supplier}
        />
      ) : null}

    </div>
  );
}

function MaterialOrderPaymentStepDialog({
  order,
  open,
  onOpenChange,
  isSaving,
  onPersist,
}: {
  order: MaterialOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onPersist: (next: MaterialOrder) => Promise<void>;
}) {
  const [paidDate, setPaidDate] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setPaidDate("");
    setExpectedDelivery(order.expectedDelivery ?? "");
  }, [open, order?.id, order?.expectedDelivery]);

  if (!order) return null;

  const handleSave = async () => {
    if (!paidDate.trim()) {
      toast.error("Unesite datum kada je plaćeno.");
      return;
    }
    if (!expectedDelivery.trim()) {
      toast.error("Unesite očekivano vreme isporuke.");
      return;
    }
    setBusy(true);
    try {
      const paidDateNote = `Plaćeno: ${paidDate}`;
      const existingNotes = order.notes?.trim() ?? "";
      const nextNotes = existingNotes.includes(paidDateNote)
        ? existingNotes
        : existingNotes
          ? `${existingNotes}\n${paidDateNote}`
          : paidDateNote;
      await onPersist({
        ...order,
        paid: true,
        paymentStatus: "paid_advance",
        expectedDelivery,
        deliveryStatus: "waiting_for_delivery",
        notes: nextNotes,
      });
      toast.success("Korak plaćanja je sačuvan.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snimanje nije uspelo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Plaćeno + rok isporuke</DialogTitle>
          <DialogDescription>
            Korak između predračuna i fakture: unesite datum plaćanja i očekivano vreme isporuke.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="material-order-paid-date">Datum plaćanja</Label>
            <Input
              id="material-order-paid-date"
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-order-expected-delivery">Očekivano vreme isporuke</Label>
            <Input
              id="material-order-expected-delivery"
              type="date"
              value={expectedDelivery}
              onChange={(e) => setExpectedDelivery(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Otkaži
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy || isSaving}>
            {busy || isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Sačuvaj korak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProcurementAdHocSection({
  order,
  items,
  canManage,
  onAdd,
  onToggleStatus,
  onDelete,
  isMutating,
}: {
  order: MaterialOrder;
  items: ProcurementAdHocItem[];
  canManage: boolean;
  onAdd: () => void;
  onToggleStatus: (item: ProcurementAdHocItem, status: ProcurementAdHocStatus) => void;
  onDelete: (item: ProcurementAdHocItem) => void;
  isMutating: boolean;
}) {
  const pendingCount = items.filter((i) => isProcurementAdHocActive(i.status)).length;
  const [pdfBusy, setPdfBusy] = useState(false);

  const handleExportPdf = async () => {
    const pendingItems = items.filter((i) => isProcurementAdHocActive(i.status));
    if (pendingItems.length === 0) {
      toast.error("Nema vanrednih stavki koje čekaju prijem.");
      return;
    }
    setPdfBusy(true);
    try {
      const supplierLabel = order.supplier?.trim() || "Nepoznat dobavljač";
      const { generateProcurementAdHocPdfForSupplierGroup } = await import(
        "@/lib/procurement-ad-hoc-pdf"
      );
      const { openPdfBlobInNewTabOrDownload } = await import("@/lib/pdf-from-html");
      const result = await generateProcurementAdHocPdfForSupplierGroup(
        pendingItems.map((it) => ({
          id: it.id,
          orderId: it.orderId,
          description: it.description,
          articleCode: it.articleCode,
          quantity: it.quantity,
          unit: it.unit,
          notes: it.notes,
          barcode: it.barcode,
          supplier: order.supplier ?? null,
          createdAt: it.createdAt,
          workOrder: it.workOrder,
          position: it.position,
          color: it.color,
          lengthMm: it.lengthMm,
        })),
        supplierLabel,
      );
      openPdfBlobInNewTabOrDownload(result.blob, result.filename);
      toast.success("PDF je otvoren u novom tabu.");
    } catch (e) {
      toast.error("Generisanje PDF-a nije uspelo", {
        description: e instanceof Error ? e.message : "Nepoznata greška.",
      });
    } finally {
      setPdfBusy(false);
    }
  };

  if (!canManage && items.length === 0) return null;
  return (
    <div className="mt-4 border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Vanredne stavke
          </p>
          {items.length > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              {pendingCount} čeka / {items.length} ukupno
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {pendingCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => void handleExportPdf()}
              disabled={pdfBusy}
            >
              {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              PDF
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={onAdd}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              + Dodaj vanrednu stavku
            </Button>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nema vanrednih stavki. Dodajte stavku koja nije na originalnoj porudžbenici, sa fajlom i barkodom za magacin.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const normalizedStatus = normalizeProcurementAdHocStatus(item.status);
            const isResolved = normalizedStatus === PROCUREMENT_AD_HOC_STATUS.RECEIVED;
            const isCanceled = normalizedStatus === PROCUREMENT_AD_HOC_STATUS.CANCELED;
            return (
              <li
                key={item.id}
                className={`rounded-md border p-2.5 text-xs ${
                  isResolved
                    ? "border-green-500/30 bg-green-50/40 dark:bg-green-950/15"
                    : isCanceled
                      ? "border-border bg-muted/30"
                      : "border-amber-500/30 bg-amber-500/[0.06]"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.articleCode ? (
                        <span className="font-mono text-[10px] text-muted-foreground">{item.articleCode}</span>
                      ) : null}
                      <span className="text-sm font-medium text-foreground">{item.description}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-card border border-border/60">
                        {item.barcode}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Količina: <span className="font-medium text-foreground">{item.quantity} {item.unit}</span>
                      {item.notes ? <span className="ml-2 italic">„{item.notes}”</span> : null}
                    </p>
                    {(item.workOrder || item.position || item.color || item.lengthMm != null) ? (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {item.workOrder ? (
                          <span>
                            Nalog: <span className="font-medium text-foreground">{item.workOrder}</span>
                          </span>
                        ) : null}
                        {item.position ? (
                          <span>
                            Poz.: <span className="font-medium text-foreground">{item.position}</span>
                          </span>
                        ) : null}
                        {item.color ? (
                          <span>
                            Boja: <span className="font-medium text-foreground">{item.color}</span>
                          </span>
                        ) : null}
                        {item.lengthMm != null && Number.isFinite(item.lengthMm) ? (
                          <span>
                            Duž.: <span className="font-medium text-foreground">{item.lengthMm} mm</span>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {item.attachmentUrl ? (
                      <a
                        href={item.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {item.attachmentName ?? "Prilog"}
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Select
                      value={normalizedStatus}
                      disabled={!canManage || isMutating}
                      onValueChange={(v) => onToggleStatus(item, v as ProcurementAdHocStatus)}
                    >
                      <SelectTrigger className="h-7 w-[13rem] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROCUREMENT_AD_HOC_STATUS_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {canManage && (
                      <ConfirmDialog
                        title="Obriši vanrednu stavku?"
                        description={`„${item.description}” će biti uklonjena iz vanrednih stavki. Akcija je nepovratna.`}
                        confirmLabel="Obriši"
                        cancelLabel="Otkaži"
                        onConfirm={() => onDelete(item)}
                        trigger={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            disabled={isMutating}
                            aria-label="Obriši vanrednu stavku"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        }
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground italic">
        Posao: {order.job?.jobNumber ?? "—"} · Vanredne stavke imaju jedinstven barkod (A…) — magacin ih prima skeniranjem na stranici „Prijem porudžbine”.
      </p>
    </div>
  );
}
