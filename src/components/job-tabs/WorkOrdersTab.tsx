import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ClipboardList, XCircle, FileDown, Plus, Pencil, FileText, MapPin, Info, UserPlus, Camera } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import { exportWorkOrderPDF } from "@/lib/export-documents";
import { useWorkOrders } from "@/hooks/use-work-orders";
import { useTeams } from "@/hooks/use-teams";
import { WorkOrderModal } from "@/components/modals/WorkOrderModal";
import { useJobRelatedData } from "@/hooks/use-job-data";
import { FieldReportDetailModal } from "@/components/modals/FieldReportDetailModal";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import type { WorkOrder, WorkOrderCreateInput, FieldReport } from "@/types";
import { fieldReportFlowForWorkOrderType, isFieldExecutionRole } from "@/lib/field-team-access";
import { useAuthStore } from "@/stores/auth-store";
import { labelWorkOrderType } from "@/lib/activity-labels";
import { WorkOrderTypeBadge } from "@/components/work-order/WorkOrderTypeBadge";
import { OpenInGoogleMapsButton } from "@/components/shared/OpenInGoogleMapsButton";
import { formatWorkOrderDescriptionForWorker } from "@/lib/work-order-description-display";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
} from "@/lib/job-status-lifecycle";
import {
  formatJobInstallationLocationDisplay,
  jobInstallationStreetAddress,
} from "@/lib/job-installation-location";
import { formatDateTimeBySettings } from "@/lib/app-settings";
import { formatWorkOrderScheduleDisplay } from "@/lib/schedule-datetime-display";
import { CameraBarcodeScanner } from "@/components/shared/CameraBarcodeScanner";
import { useJobItems } from "@/hooks/use-job-items";
import { isProductionWorkOrderPhaseDeferred } from "@/lib/production-workflow-phase";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const statusVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  completed: "success", in_progress: "info", pending: "warning", canceled: "muted",
};

const statusLabels: Record<string, string> = {
  completed: "Završen", in_progress: "U toku", pending: "Na čekanju", canceled: "Otkazan",
};

type WorkOrdersTabProps = {
  jobId?: string;
  workOrders?: WorkOrder[];
  /** Sa kartice „Aktivni radni nalozi“ na pregledu posla — otvara detalje (isti modal kao „Detalji“). */
  openDetailWorkOrderId?: string | null;
  onOpenDetailWorkOrderIdConsumed?: () => void;
};

export function WorkOrdersTab({
  jobId,
  workOrders,
  openDetailWorkOrderId,
  onOpenDetailWorkOrderIdConsumed,
}: WorkOrdersTabProps) {
  const queryClient = useQueryClient();
  const { workOrders: orders, isLoading, createWorkOrder, updateWorkOrder } = useWorkOrders(jobId);
  const { fieldReports } = useJobRelatedData(jobId);
  const { completeByBarcode } = useJobItems(jobId);
  const { teams } = useTeams();
  const navigate = useNavigate();
  const { canPerformAction } = useRole();
  const { user } = useAuthStore();
  const isFieldWorker = isFieldExecutionRole(user?.role);

  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [scanningJobId, setScanningJobId] = useState<string | null>(null);

  const handleScanSuccess = async (barcode: string) => {
    const targetJobId = scanningJobId || jobId;
    if (!targetJobId) {
      toast.error("Greška: Nije pronađen ID posla za skeniranje.");
      return;
    }

    try {
      await completeByBarcode.mutateAsync({ jobId: targetJobId, barcode });
      toast.success(`Uspešno skenirano: ${barcode}`);
      setIsCameraScannerOpen(false);
      setScanningJobId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Skeniranje nije uspelo");
    }
  };

  const canAddReportForOrder = (order: WorkOrder) => {
    const flow = fieldReportFlowForWorkOrderType(order.type);
    return (
      (flow === "mounting" && canPerformAction("add_mounting_report")) ||
      (flow === "field" && canPerformAction("add_field_report")) ||
      (flow === "production" &&
        (
          canPerformAction("add_field_report") ||
          canPerformAction("update_production_status") ||
          canPerformAction("view_production_details")
        ))
    );
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | undefined>(undefined);
  const [reportDetailOpen, setReportDetailOpen] = useState(false);
  const [newReportOpen, setNewReportOpen] = useState(false);
  const [selectedFieldReport, setSelectedFieldReport] = useState<FieldReport | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | undefined>(undefined);
  /** Brza dodela tima (popover) — ID naloga čiji je popover otvoren. */
  const [assignTeamPopoverWoId, setAssignTeamPopoverWoId] = useState<string | null>(null);
  const [assignTeamId, setAssignTeamId] = useState("");

  const handleCancel = (order: WorkOrder) => {
    updateWorkOrder.mutate(
      { ...order, status: "canceled" },
      {
        onSuccess: () => toast.success("Radni nalog otkazan"),
        onError: (err) => {
          const message = err instanceof Error ? err.message : "Otkaživanje nije uspelo.";
          toast.error(message);
        },
      },
    );
  };

  const handleReportAction = (orderId: string) => {
    const targetOrder = baseOrders.find((o) => o.id === orderId);
    if (
      targetOrder &&
      isFieldWorker &&
      !!user?.teamId &&
      targetOrder.assignedTeamId === user.teamId &&
      targetOrder.status !== "in_progress"
    ) {
      toast.error("Prvo pokrenite nalog, pa zatim završite kroz formu.");
      return;
    }

    const existingReport = fieldReports?.find(r => r.workOrderId === orderId);
    if (existingReport) {
      setSelectedFieldReport(existingReport);
      setReportDetailOpen(true);
    } else {
      setSelectedWorkOrderId(orderId);
      setNewReportOpen(true);
    }
  };

  const handleFinishOrder = (orderId: string) => {
    setSelectedFieldReport(null);
    setReportDetailOpen(false);
    setSelectedWorkOrderId(orderId);
    setNewReportOpen(true);
  };

  const baseOrders = useMemo(() => {
    const live = orders ?? [];
    if (!workOrders) return live;
    if (live.length === 0) return workOrders;
    const liveById = new Map(live.map((o) => [o.id, o]));
    return workOrders.map((o) => liveById.get(o.id) ?? o);
  }, [workOrders, orders]);

  useEffect(() => {
    if (!openDetailWorkOrderId) return;
    const target = baseOrders.find((o) => o.id === openDetailWorkOrderId);
    if (!target) {
      if (!isLoading) onOpenDetailWorkOrderIdConsumed?.();
      return;
    }
    setSelectedOrder(target);
    setModalReadOnly(true);
    setModalOpen(true);
    onOpenDetailWorkOrderIdConsumed?.();
  }, [openDetailWorkOrderId, baseOrders, isLoading, onOpenDetailWorkOrderIdConsumed]);

  const visibleOrders = isProductionWorkOrderPhaseDeferred()
    ? baseOrders.filter((o) => o.type !== "production")
    : baseOrders;
  const hiddenProductionCount = isProductionWorkOrderPhaseDeferred()
    ? baseOrders.filter((o) => o.type === "production").length
    : 0;
  const activeOwnTeamOrder = visibleOrders.find(
    (order) =>
      !!user?.teamId &&
      order.assignedTeamId === user.teamId &&
      order.status === "in_progress"
  );

  /** Globalna stranica Radni nalozi (bez jobId) — ime kupca kao outline dugme. */
  const jobCustomerLinkAsButton = !jobId && workOrders !== undefined;

  const handleStartOrder = (order: WorkOrder) => {
    if (!user?.teamId) return;
    if (activeOwnTeamOrder && activeOwnTeamOrder.id !== order.id) {
      toast.error("Već imate pokrenut nalog. Završite ga pre pokretanja sledećeg.");
      return;
    }
    updateWorkOrder.mutate(
      { ...order, status: "in_progress" },
      {
        onSuccess: () => {
          setSelectedOrder((prev) =>
            prev?.id === order.id ? ({ ...prev, status: "in_progress" } as WorkOrder) : prev,
          );
        },
      },
    );
  };

  const canStartOwnTeamOrder = (order: WorkOrder) => {
    return (
      isFieldWorker &&
      !!user?.teamId &&
      order.assignedTeamId === user.teamId &&
      order.status === "pending"
    );
  };

  const canQuickAssignTeam = (order: WorkOrder) =>
    (canPerformAction("edit_work_order") || canPerformAction("update_job_status")) &&
    !order.assignedTeamId &&
    order.status !== "completed" &&
    order.status !== "canceled";

  const handleAddOrder = () => {
    setSelectedOrder(undefined);
    setModalReadOnly(false);
    setModalOpen(true);
  };

  const handleEditOrder = (order: WorkOrder) => {
    setSelectedOrder(order);
    setModalReadOnly(false);
    setModalOpen(true);
  };

  const handleViewOrder = (order: WorkOrder) => {
    setSelectedOrder(order);
    setModalReadOnly(true);
    setModalOpen(true);
  };

  const handleSaveOrder = async (orderData: WorkOrderCreateInput | WorkOrder) => {
    if ("id" in orderData && (orderData as WorkOrder).id) {
      await updateWorkOrder.mutateAsync(orderData as WorkOrder);
    } else {
      await createWorkOrder.mutateAsync(orderData as WorkOrderCreateInput);
    }
  };

  const canStartSelectedFromDetails =
    modalReadOnly && !!selectedOrder && canStartOwnTeamOrder(selectedOrder);
  const canFinishSelectedFromDetails =
    modalReadOnly &&
    !!selectedOrder &&
    isFieldWorker &&
    !!user?.teamId &&
    selectedOrder.assignedTeamId === user.teamId &&
    selectedOrder.status === "in_progress";
  const startSelectedDisabled =
    !!selectedOrder &&
    !!activeOwnTeamOrder &&
    activeOwnTeamOrder.id !== selectedOrder.id;
  const startSelectedDisabledReason = startSelectedDisabled
    ? "Završite aktivni nalog pre pokretanja sledećeg."
    : undefined;

  if (isLoading && !workOrders) return <div className="p-8 flex justify-center"><ClipboardList className="w-8 h-8 animate-pulse text-muted" /></div>;

  return (
    <div>
      {hiddenProductionCount > 0 ? (
        <Alert className="mb-3 border-muted-foreground/25 bg-muted/30">
          <Info className="h-4 w-4" />
          <AlertTitle>Proizvodnja nije u ovom pregledu</AlertTitle>
          <AlertDescription>
            U fazi 1 proizvodnja se vodi van CRM-a; sakriveno je {hiddenProductionCount}{" "}
            {hiddenProductionCount === 1 ? "nalog tipa Proizvodnja" : "naloga tipa Proizvodnja"} (i dalje postoje u bazi).
          </AlertDescription>
        </Alert>
      ) : null}
      <SectionHeader
        title="Radni nalozi"
        subtitle={`${visibleOrders.length} nalog${visibleOrders.length === 1 ? "" : "a"}`}
        icon={ClipboardList}
        actions={canPerformAction("create_work_order") ? (
          <Button size="sm" onClick={handleAddOrder} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Novi radni nalog
          </Button>
        ) : undefined}
      />
      {visibleOrders.length === 0 ? (
        <EmptyState 
          icon={ClipboardList} 
          title="Nema radnih naloga" 
          description={jobId ? "Nema radnih naloga za ovaj posao." : "Nema radnih naloga."} 
          actionLabel={canPerformAction("create_work_order") ? "Novi radni nalog" : undefined}
          onAction={handleAddOrder}
        />
      ) : (
        <div className="grid gap-3">
          {visibleOrders.map((o) => {
            const team = teams?.find(t => t.id === o.assignedTeamId);
            const orderWithJob = o as WorkOrder & {
              job?: {
                id: string;
                jobNumber: string;
                customerName?: string;
                installationAddress?: string;
                installationApartment?: string | null;
                installationFloor?: string | null;
              };
            };
            const jobLinkLabel =
              orderWithJob.job?.customerName?.trim() ||
              orderWithJob.job?.jobNumber ||
              "Posao";
            return (
              <div key={o.id} className="bg-card rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ClipboardList className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {!isFieldWorker ? <WorkOrderTypeBadge type={o.type} size="sm" /> : null}
                      <GenericBadge label={statusLabels[o.status]} variant={statusVariant[o.status]} />
                      {!o.assignedTeamId ? (
                        <GenericBadge label="Neraspoređeno" variant="warning" />
                      ) : null}
                      {orderWithJob.job ? (
                        <button
                          type="button"
                          className={cn(
                            "text-[11px] text-primary font-medium",
                            jobCustomerLinkAsButton
                              ? "inline-flex items-center rounded-md border border-input bg-background px-2 py-0.5 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground dark:border-white/[0.15]"
                              : "hover:underline",
                          )}
                          onClick={() => navigate(`/jobs/${orderWithJob.job!.id}`)}
                        >
                          {jobLinkLabel}
                        </button>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {isFieldExecutionRole(user?.role)
                        ? formatWorkOrderDescriptionForWorker(o.description, o.type)
                        : o.description}
                    </p>
                    
                    {(() => {
                      const isMeasOrInst =
                        o.type === INSTALLATION_WORK_ORDER_TYPE ||
                        MEASUREMENT_WORK_ORDER_TYPES.includes(o.type);
                      if (!isMeasOrInst || !orderWithJob.job) return null;
                      const street = jobInstallationStreetAddress({
                        installationAddress: orderWithJob.job.installationAddress,
                      });
                      const label = formatJobInstallationLocationDisplay({
                        installationAddress: orderWithJob.job.installationAddress,
                        installationApartment: orderWithJob.job.installationApartment,
                        installationFloor: orderWithJob.job.installationFloor,
                      });
                      if (!label.trim()) return null;
                      return (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-start gap-1.5 min-w-0">
                            <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                            <span className="text-xs font-medium text-foreground leading-snug">{label}</span>
                          </div>
                          {street ? (
                            <OpenInGoogleMapsButton address={street} size="default" className="w-full sm:w-auto" />
                          ) : null}
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                      <span>
                        Tim:{" "}
                        <span className="text-foreground font-medium">
                          {team?.name || (o.assignedTeamId ? "—" : "Neraspoređeno")}
                        </span>
                      </span>
                      {!isFieldWorker ? (
                        <span>
                          Kreiran:{" "}
                          <span className="text-foreground font-medium">
                            {o.createdAt ? formatDateTimeBySettings(o.createdAt) : "—"}
                          </span>
                        </span>
                      ) : null}
                      <span>
                        Zakazan:{" "}
                        <span className="text-foreground font-medium">
                          {formatWorkOrderScheduleDisplay({
                            date: o.date,
                            description: o.description,
                            type: o.type,
                          }) || o.date}
                        </span>
                      </span>
                      {o.productionRef && <span>Proiz: <span className="font-medium">{o.productionRef}</span></span>}
                      {o.installationRef && <span>Ugr: <span className="font-medium">{o.installationRef}</span></span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={() => handleViewOrder(o)}>
                      <Info className="w-4 h-4 mr-1" /> Detalji
                    </Button>
                    {o.type === "production" && o.status !== "completed" && o.status !== "canceled" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-primary"
                        onClick={() => {
                          setScanningJobId(o.jobId);
                          setIsCameraScannerOpen(true);
                        }}
                        title="Skeniraj profile kamerom"
                      >
                        <Camera className="w-4 h-4 mr-1" /> Skeniraj
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-primary"
                      onClick={() =>
                        void exportWorkOrderPDF(o, {
                          attachGeneratedPdf: !!user?.id && !!jobId,
                          userId: user?.id,
                          onPdfAttached: (r) => {
                            if (jobId) void queryClient.invalidateQueries({ queryKey: ["files", jobId] });
                            void queryClient.invalidateQueries({ queryKey: ["files", "all"] });
                            invalidateFilesStorageUsage(queryClient);
                            toast.success(r === "updated" ? "PDF je ažuriran u Fajlovima" : "PDF je sačuvan u Fajlovima");
                          },
                          onPdfAttachFailed: (m) =>
                            toast.error("Štampa je otvorena, ali PDF nije sačuvan", { description: m }),
                        })
                      }
                    >
                      <FileDown className="w-4 h-4 mr-1" /> PDF
                    </Button>
                    {canQuickAssignTeam(o) && (
                      <Popover
                        open={assignTeamPopoverWoId === o.id}
                        onOpenChange={(open) => {
                          if (open) {
                            setAssignTeamPopoverWoId(o.id);
                            setAssignTeamId("");
                          } else {
                            setAssignTeamPopoverWoId(null);
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="shrink-0 border-warning/40 text-foreground hover:bg-warning/10">
                            <UserPlus className="w-4 h-4 mr-1" />
                            Dodeli tim
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80" align="end">
                          <div className="space-y-3">
                            <div>
                              <p className="text-sm font-medium">Dodela tima</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {labelWorkOrderType(o.type)} ·{" "}
                                {formatWorkOrderScheduleDisplay({
                                  date: o.date,
                                  description: o.description,
                                  type: o.type,
                                }) || o.date}
                              </p>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">Tim</Label>
                              <Select value={assignTeamId || undefined} onValueChange={setAssignTeamId}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Izaberite tim" />
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
                            {!(teams ?? []).some((t) => t.active) ? (
                              <p className="text-xs text-destructive">Nema aktivnih timova. Dodajte tim u podešavanjima.</p>
                            ) : null}
                            <div className="flex justify-end gap-2 pt-1">
                              <Button variant="ghost" size="sm" type="button" onClick={() => setAssignTeamPopoverWoId(null)}>
                                Otkaži
                              </Button>
                              <Button
                                size="sm"
                                type="button"
                                disabled={!assignTeamId || updateWorkOrder.isPending}
                                onClick={() => {
                                  updateWorkOrder.mutate(
                                    { ...o, assignedTeamId: assignTeamId },
                                    {
                                      onSuccess: () => {
                                        setAssignTeamPopoverWoId(null);
                                        setAssignTeamId("");
                                      },
                                    },
                                  );
                                }}
                              >
                                Sačuvaj
                              </Button>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                    {isFieldWorker && !!user?.teamId && o.assignedTeamId === user.teamId && o.status === "in_progress" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-primary"
                        onClick={() => handleFinishOrder(o.id)}
                      >
                        <FileText className="w-4 h-4 mr-1" />
                        {o.type === "production" ? "Popuni izveštaj" : "Završi"}
                      </Button>
                    )}
                    {!(
                      isFieldWorker &&
                      !!user?.teamId &&
                      o.assignedTeamId === user.teamId &&
                      o.status === "in_progress"
                    ) && (fieldReports?.some((r) => r.workOrderId === o.id) || canAddReportForOrder(o)) && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className={cn(
                          "text-muted-foreground hover:text-primary",
                          fieldReports?.some(r => r.workOrderId === o.id) && "text-primary font-medium"
                        )} 
                        disabled={
                          !!activeOwnTeamOrder &&
                          activeOwnTeamOrder.id !== o.id &&
                          o.status !== "completed" &&
                          o.status !== "canceled"
                        }
                        title={
                          !!activeOwnTeamOrder &&
                          activeOwnTeamOrder.id !== o.id &&
                          o.status !== "completed" &&
                          o.status !== "canceled"
                            ? "Završite nalog koji je u toku (sačuvajte izveštaj), pa zatim ostale."
                            : undefined
                        }
                        onClick={() => handleReportAction(o.id)}
                      >
                        <FileText className="w-4 h-4 mr-1" /> 
                        {fieldReports?.some(r => r.workOrderId === o.id) ? "Pregledaj izveštaj" : "Dodaj izveštaj"}
                      </Button>
                    )}
                    {canStartOwnTeamOrder(o) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-primary"
                        disabled={!!activeOwnTeamOrder && activeOwnTeamOrder.id !== o.id}
                        title={
                          !!activeOwnTeamOrder && activeOwnTeamOrder.id !== o.id
                            ? "Završite aktivni nalog pre pokretanja sledećeg."
                            : "Pokreni radni nalog"
                        }
                        onClick={() => handleStartOrder(o)}
                      >
                        Pokreni
                      </Button>
                    )}
                    {canPerformAction("edit_work_order") && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={() => handleEditOrder(o)}>
                        <Pencil className="w-4 h-4 mr-1" /> Izmeni
                      </Button>
                    )}
                    {canPerformAction("cancel_work_order") && o.status !== "completed" && o.status !== "canceled" && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0">
                            <XCircle className="w-4 h-4 mr-1" /> Otkaži
                          </Button>
                        }
                        title="Otkazati ovaj radni nalog?"
                        description={`Ovo će otkazati radni nalog "${labelWorkOrderType(o.type)}"${team?.name ? ` dodeljen timu ${team.name}` : " (neraspoređen)"} za ${o.date}.`}
                        confirmLabel="Otkaži nalog"
                        variant="warning"
                        onConfirm={() => handleCancel(o)}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <WorkOrderModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onSave={handleSaveOrder} 
        onStartOrder={(order) => {
          handleStartOrder(order);
        }}
        canStartFromDetails={canStartSelectedFromDetails}
        startDisabled={startSelectedDisabled}
        startDisabledReason={startSelectedDisabledReason}
        onFinishOrder={(order) => {
          handleFinishOrder(order.id);
          setModalOpen(false);
        }}
        canFinishFromDetails={canFinishSelectedFromDetails}
        jobId={jobId} 
        order={selectedOrder} 
        readOnly={modalReadOnly}
      />

      <FieldReportDetailModal 
        report={selectedFieldReport} 
        open={reportDetailOpen} 
        onOpenChange={setReportDetailOpen} 
      />

      <NewFieldReportModal 
        open={newReportOpen} 
        onOpenChange={setNewReportOpen} 
        workOrderId={selectedWorkOrderId}
      />

      {isCameraScannerOpen && (
        <CameraBarcodeScanner
          onScanSuccess={handleScanSuccess}
          onClose={() => {
            setIsCameraScannerOpen(false);
            setScanningJobId(null);
          }}
        />
      )}
    </div>
  );
}
