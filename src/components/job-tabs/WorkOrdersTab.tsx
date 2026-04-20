import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, XCircle, FileDown, Plus, Pencil, FileText, MapPin, Info, UserPlus } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/contexts/RoleContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { exportWorkOrderPDF } from "@/lib/export-documents";
import { useWorkOrders } from "@/hooks/use-work-orders";
import { useTeams } from "@/hooks/use-teams";
import { WorkOrderModal } from "@/components/modals/WorkOrderModal";
import { useJobRelatedData } from "@/hooks/use-job-data";
import { FieldReportDetailModal } from "@/components/modals/FieldReportDetailModal";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import type { WorkOrder, FieldReport } from "@/types";
import { fieldReportFlowForWorkOrderType, isFieldExecutionRole } from "@/lib/field-team-access";
import { useAuthStore } from "@/stores/auth-store";
import { labelWorkOrderType } from "@/lib/activity-labels";

const statusVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  completed: "success", in_progress: "info", pending: "warning", canceled: "muted",
};

const statusLabels: Record<string, string> = {
  completed: "Završen", in_progress: "U toku", pending: "Na čekanju", canceled: "Otkazan",
};

type WorkOrdersTabProps = {
  jobId?: string;
  workOrders?: WorkOrder[];
};

export function WorkOrdersTab({ jobId, workOrders }: WorkOrdersTabProps) {
  const { workOrders: orders, isLoading, createWorkOrder, updateWorkOrder } = useWorkOrders(jobId);
  const { fieldReports } = useJobRelatedData(jobId);
  const { teams } = useTeams();
  const navigate = useNavigate();
  const { canPerformAction } = useRole();
  const { user } = useAuthStore();
  const isFieldWorker = isFieldExecutionRole(user?.role);

  const canAddReportForOrder = (order: WorkOrder) => {
    const flow = fieldReportFlowForWorkOrderType(order.type);
    return (
      (flow === "mounting" && canPerformAction("add_mounting_report")) ||
      (flow === "field" && canPerformAction("add_field_report")) ||
      (flow === "production" &&
        (canPerformAction("add_field_report") || canPerformAction("update_production_status")))
    );
  };

  const openInGoogleMaps = (address: string) => {
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
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
    updateWorkOrder.mutate({ ...order, status: "canceled" });
    toast.success("Radni nalog otkazan");
  };

  const handleReportAction = (orderId: string) => {
    const targetOrder = (workOrders ?? orders ?? []).find((o) => o.id === orderId);
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

  const visibleOrders = workOrders ?? orders ?? [];
  const activeOwnTeamOrder = visibleOrders.find(
    (order) =>
      !!user?.teamId &&
      order.assignedTeamId === user.teamId &&
      order.status === "in_progress"
  );

  const handleStartOrder = (order: WorkOrder) => {
    if (!user?.teamId) return;
    if (activeOwnTeamOrder && activeOwnTeamOrder.id !== order.id) {
      toast.error("Već imate pokrenut nalog. Završite ga pre pokretanja sledećeg.");
      return;
    }
    updateWorkOrder.mutate({ ...order, status: "in_progress" });
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

  const handleSaveOrder = (orderData: Omit<WorkOrder, "id"> | WorkOrder) => {
    if ('id' in orderData) {
      updateWorkOrder.mutate(orderData as WorkOrder);
    } else {
      createWorkOrder.mutate(orderData);
    }
  };

  if (isLoading && !workOrders) return <div className="p-8 flex justify-center"><ClipboardList className="w-8 h-8 animate-pulse text-muted" /></div>;

  return (
    <div>
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
            const orderWithJob = o as WorkOrder & { job?: { id: string, jobNumber: string, installationAddress?: string } };
            return (
              <div key={o.id} className="bg-card rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ClipboardList className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{labelWorkOrderType(o.type)}</span>
                      <GenericBadge label={statusLabels[o.status]} variant={statusVariant[o.status]} />
                      {!o.assignedTeamId ? (
                        <GenericBadge label="Neraspoređeno" variant="warning" />
                      ) : null}
                      {orderWithJob.job && !canPerformAction("view_own_team_only") && (
                        <button className="text-[11px] text-primary hover:underline font-medium" onClick={() => navigate(`/jobs/${orderWithJob.job?.id}`)}>
                          {orderWithJob.job.jobNumber}
                        </button>
                      )}
                      {orderWithJob.job && canPerformAction("view_own_team_only") && (
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {orderWithJob.job.jobNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{o.description}</p>
                    
                    {orderWithJob.job?.installationAddress && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-xs font-medium text-foreground truncate">{orderWithJob.job.installationAddress}</span>
                        <button 
                          onClick={() => openInGoogleMaps(orderWithJob.job!.installationAddress!)}
                          className="text-[10px] text-primary hover:underline ml-1 font-semibold"
                        >
                          Otvori u Google Mapama
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                      <span>
                        Tim:{" "}
                        <span className="text-foreground font-medium">
                          {team?.name || (o.assignedTeamId ? "—" : "Neraspoređeno")}
                        </span>
                      </span>
                      <span>Datum: <span className="text-foreground font-medium">{o.date}</span></span>
                      {o.productionRef && <span>Proiz: <span className="font-medium">{o.productionRef}</span></span>}
                      {o.installationRef && <span>Ugr: <span className="font-medium">{o.installationRef}</span></span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={() => handleViewOrder(o)}>
                      <Info className="w-4 h-4 mr-1" /> Detalji
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary" onClick={() => void exportWorkOrderPDF(o)}>
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
                                {labelWorkOrderType(o.type)} · {o.date}
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
                        Završi
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
    </div>
  );
}
