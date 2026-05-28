import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isProductionWorkOrderPhaseDeferred } from "@/lib/production-workflow-phase";
import { useQueryClient } from "@tanstack/react-query";
import { Calendar, MapPin, Phone, Loader2, Hammer, Camera, Paperclip, Eye } from "lucide-react";
import { format, isSameDay, parse } from "date-fns";
import { sr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { FieldTeamWorkOrdersMap } from "@/components/dashboard/FieldTeamWorkOrdersMap";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import { WorkOrderModal } from "@/components/modals/WorkOrderModal";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { WorkOrder } from "@/types";
import { useRole } from "@/contexts/RoleContext";
import { useAuthStore } from "@/stores/auth-store";
import { labelWorkOrderStatus } from "@/lib/activity-labels";
import { workOrderStatusBadgeClassName } from "@/lib/work-order-status-badge";
import { OpenInGoogleMapsButton } from "@/components/shared/OpenInGoogleMapsButton";
import { formatWorkOrderDescriptionForWorker } from "@/lib/work-order-description-display";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { ensureWorkflowWorkOrders } from "@/lib/work-order-workflow-automation";
import { isLightweightFieldVisitWorkOrderType } from "@/lib/work-order-detail-hints";
import { CameraBarcodeScanner } from "@/components/shared/CameraBarcodeScanner";
import { useFieldTeamData, fieldTeamWorkOrdersQueryKey } from "@/hooks/use-field-team-data";
import { useJobItems } from "@/hooks/use-job-items";
import {
  getFieldTeamWorkOrderAddress,
  getFieldTeamWorkOrderStreetForMaps,
} from "@/lib/field-team-work-order-display";
import { formatFieldTeamWorkOrderScheduleDisplay } from "@/lib/schedule-datetime-display";

/** Datum termina u lokalnom kalendaru (`YYYY-MM-DD` ili pun ISO string). */
function workOrderScheduledLocalDay(dateStr: string | undefined | null): Date | null {
  const trimmed = (dateStr ?? "").trim();
  if (!trimmed) return null;
  const dateOnly = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return parse(dateOnly, "yyyy-MM-dd", new Date());
  }
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isWorkOrderScheduledToday(dateStr: string | undefined | null, ref: Date = new Date()): boolean {
  const day = workOrderScheduledLocalDay(dateStr);
  return !!day && isSameDay(day, ref);
}

/** Na dashboardu: svi statusi samo ako je termin zakazan za današnji dan (lokalni kalendar). */
function isWorkOrderVisibleOnFieldDashboard(wo: WorkOrder, ref: Date = new Date()): boolean {
  return isWorkOrderScheduledToday(wo.date, ref);
}

export function FieldTeamDashboard() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { currentRole } = useRole();
  const { workOrders, isLoading } = useFieldTeamData();
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | null>(null);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | undefined>(undefined);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const { toast } = useToast();

  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [scanningJobId, setScanningJobId] = useState<string | null>(null);
  const { completeByBarcode } = useJobItems(scanningJobId || "");

  /** Mora biti pre uslovnog return-a (loading), inače React prijavljuje promenu broja hook-ova. */
  useEffect(() => {
    if (!detailModalOpen || !selectedWO?.id || !workOrders) return;
    const fresh = workOrders.find((w) => w.id === selectedWO.id);
    if (fresh && fresh.status !== selectedWO.status) {
      setSelectedWO(fresh);
    }
  }, [detailModalOpen, selectedWO?.id, selectedWO?.status, workOrders]);

  const fieldTeamOrdersTeamScoped = useMemo(() => {
    return isProductionWorkOrderPhaseDeferred()
      ? (workOrders ?? []).filter((wo) => wo.type !== "production")
      : (workOrders ?? []);
  }, [workOrders]);

  const fieldTeamOrdersVisible = useMemo(() => {
    const list = fieldTeamOrdersTeamScoped.filter((wo) => isWorkOrderVisibleOnFieldDashboard(wo));
    const statusRank: Record<WorkOrder["status"], number> = {
      pending: 0,
      in_progress: 1,
      completed: 2,
      canceled: 3,
    };
    return [...list].sort((a, b) => {
      const ra = statusRank[a.status] ?? 99;
      const rb = statusRank[b.status] ?? 99;
      if (ra !== rb) return ra - rb;
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return da - db;
    });
  }, [fieldTeamOrdersTeamScoped]);

  const activeWorkOrder = fieldTeamOrdersVisible.find((wo) => wo.status === "in_progress");

  const canStartSelectedFromDetails =
    detailModalOpen &&
    !!selectedWO &&
    !!user?.teamId &&
    selectedWO.assignedTeamId === user.teamId &&
    selectedWO.status === "pending";

  const startSelectedDisabled =
    !!selectedWO && !!activeWorkOrder && activeWorkOrder.id !== selectedWO.id;

  const canFinishSelectedFromDetails =
    detailModalOpen &&
    !!selectedWO &&
    !!user?.teamId &&
    selectedWO.assignedTeamId === user.teamId &&
    selectedWO.status === "in_progress";

  const hasTeamOrdersNotToday =
    fieldTeamOrdersTeamScoped.length > 0 && fieldTeamOrdersVisible.length === 0;

  const handleScanSuccess = async (barcode: string) => {
    if (!scanningJobId) return;

    try {
      await completeByBarcode.mutateAsync({ jobId: scanningJobId, barcode });
      toast({
        title: "Uspešno skenirano",
        description: `Profil ${barcode} je markiran kao završen.`,
      });
      // Ne zatvaramo skener odmah da bi mogli skenirati više profila zaredom
    } catch (error) {
      toast({
        title: "Greška",
        description: error instanceof Error ? error.message : "Skeniranje nije uspelo",
        variant: "destructive",
      });
    }
  };

  const statusLabels: Record<string, string> = {
    pending: "Na čekanju",
    in_progress: "U toku",
    completed: "Završen",
    canceled: "Otkazan",
  };

  const handleOpenDetails = (wo: WorkOrder) => {
    setSelectedWO(wo);
    setDetailModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleStatusUpdate = async (workOrderId: string, newStatus: string, jobId: string) => {
    try {
      const { data: curWo, error: curErr } = await supabase
        .from("work_orders")
        .select("status")
        .eq("id", workOrderId)
        .single();
      if (curErr) throw curErr;

      const patch: { status: string; field_started_at?: string } = { status: newStatus };
      if (newStatus === "in_progress" && curWo?.status === "pending") {
        patch.field_started_at = new Date().toISOString();
      }

      const { error } = await supabase.from("work_orders").update(patch).eq("id", workOrderId);

      if (error) throw error;

      try {
        await recomputeJobStatus(jobId, user?.id ?? null);
      } catch (recomputeErr) {
        console.warn("Auto status posla posle promene naloga (teren):", recomputeErr);
      }

      try {
        await ensureWorkflowWorkOrders(jobId);
      } catch (ensureErr) {
        console.warn("ensureWorkflowWorkOrders posle promene naloga (teren):", ensureErr);
      }

      await queryClient.invalidateQueries({
        queryKey: fieldTeamWorkOrdersQueryKey(user?.teamId, user?.role),
      });
      await queryClient.invalidateQueries({ queryKey: ["field-team-map-markers"] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["activities"] });

      toast({
        title: "Status ažuriran",
        description: `Radni nalog je sada u statusu: ${statusLabels[newStatus] ?? newStatus}`,
      });
    } catch (err) {
      console.error("Error updating status:", err);
      toast({
        title: "Greška",
        description: "Nije uspelo ažuriranje statusa.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Moji radni nalozi</h2>
          <p className="text-muted-foreground">
            Prikazani su samo nalozi čiji je termin zakazan za danas (
            {format(new Date(), "dd. MMMM yyyy.", { locale: sr })}), u svim statusima. Lista se osvežava automatski.
          </p>
        </div>
      </div>

      {fieldTeamOrdersVisible.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {fieldTeamOrdersVisible.map((wo) => (
            <Card 
              key={wo.id} 
              className="overflow-hidden border-l-4 border-l-primary hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleOpenDetails(wo)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={workOrderStatusBadgeClassName(wo.status)}>
                        {labelWorkOrderStatus(wo.status)}
                      </Badge>
                      {wo.job?.id ? (
                        <Link
                          to={`/jobs/${wo.job.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-semibold text-primary hover:underline truncate max-w-full"
                          title={wo.job.customer?.fullName || wo.job.jobNumber}
                        >
                          {wo.job.customer?.fullName?.trim() || wo.job.jobNumber || "—"}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-foreground truncate">—</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right space-y-1 shrink-0 max-w-[12rem]">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Zakazano</p>
                    <div className="flex items-start justify-end gap-1 text-sm font-medium leading-snug tabular-nums">
                      <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-right">{wo.date ? formatFieldTeamWorkOrderScheduleDisplay(wo) : "Nije zakazano"}</span>
                    </div>
                    {wo.attachmentFileId ? (
                      <div
                        className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"
                        title={wo.attachmentName || "Prilog uz nalog"}
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[8rem]">{wo.attachmentName || "Prilog"}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-2 min-w-0 flex-1">
                      <span>{getFieldTeamWorkOrderAddress(wo) || "Nema adrese"}</span>
                      <OpenInGoogleMapsButton
                        address={getFieldTeamWorkOrderStreetForMaps(wo)}
                        stopPropagation
                        size="default"
                        className="w-full"
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <Phone className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                    <a
                      href={`tel:${jobPrimaryPhone({
                        customerPhone: wo.job?.customerPhone,
                        customer: wo.job?.customer,
                      })}`}
                      className="text-primary hover:underline"
                    >
                      {jobPrimaryPhone({
                        customerPhone: wo.job?.customerPhone,
                        customer: wo.job?.customer,
                      }) || "Nema telefona"}
                    </a>
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                    {isLightweightFieldVisitWorkOrderType(wo.type) ? "Nalog" : "Opis posla"}
                  </p>
                  <p className="text-sm line-clamp-2">
                    {formatWorkOrderDescriptionForWorker(wo.description, wo.type) || "Nema opisa"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full mt-2.5 h-11 px-4 text-sm font-semibold"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenDetails(wo);
                    }}
                  >
                    <Eye className="h-4 w-4 mr-2 shrink-0" />
                    Klikni da vidiš detalje naloga
                  </Button>
                </div>

                {wo.status !== "completed" && wo.status !== "canceled" && (
                  <div className="pt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={wo.status === "pending" && !!activeWorkOrder && activeWorkOrder.id !== wo.id}
                      title={
                        wo.status === "pending" && !!activeWorkOrder && activeWorkOrder.id !== wo.id
                          ? "Završite aktivni nalog (sačuvajte izveštaj) pre pokretanja sledećeg."
                          : wo.status === "in_progress"
                            ? "Otvara formu izveštaja; posle čuvanja nalog je završen."
                            : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wo.status === "pending") {
                          void handleStatusUpdate(wo.id, "in_progress", wo.jobId);
                          return;
                        }
                        if (wo.status === "in_progress") {
                          setSelectedWorkOrder(wo.id);
                          setReportModalOpen(true);
                        }
                      }}
                    >
                      {wo.status === "pending"
                        ? "Započni"
                        : wo.type === "production"
                          ? "Popuni izveštaj"
                          : "Završi"}
                    </Button>
                    {wo.type === "production" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="px-3"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScanningJobId(wo.jobId);
                          setIsCameraScannerOpen(true);
                        }}
                        title="Skeniraj profile kamerom"
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-xl border border-dashed border-border">
          <Hammer className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="font-semibold text-lg">
            {hasTeamOrdersNotToday ? "Nema naloga za danas" : "Nema dodeljenih naloga"}
          </h3>
          <p className="text-muted-foreground">
            {hasTeamOrdersNotToday
              ? "Imate dodeljene naloge na druge datume — oni se ovde ne prikazuju. Za današnji dan nema zakazanih termina."
              : "Trenutno nemate dodeljenih radnih naloga."}
          </p>
        </div>
      )}

      {currentRole !== "production" ? (
        <FieldTeamWorkOrdersMap workOrders={fieldTeamOrdersVisible} onOpenWorkOrder={handleOpenDetails} />
      ) : null}

      {selectedWorkOrder && (
        <NewFieldReportModal
          open={reportModalOpen}
          onOpenChange={(open) => {
            setReportModalOpen(open);
            if (!open) setSelectedWorkOrder(null);
          }}
          workOrderId={selectedWorkOrder}
        />
      )}

      <WorkOrderModal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        onSave={() => {}}
        order={selectedWO}
        readOnly={true}
        onStartOrder={(ord) => {
          if (!user?.teamId) return;
          if (activeWorkOrder && activeWorkOrder.id !== ord.id) {
            toast({
              title: "Nalog je već u toku",
              description: "Završite aktivni nalog (sačuvajte izveštaj) pre pokretanja sledećeg.",
              variant: "destructive",
            });
            return;
          }
          void handleStatusUpdate(ord.id, "in_progress", ord.jobId);
        }}
        canStartFromDetails={canStartSelectedFromDetails}
        startDisabled={startSelectedDisabled}
        startDisabledReason={
          startSelectedDisabled ? "Završite aktivni nalog pre pokretanja sledećeg." : undefined
        }
        onFinishOrder={(ord) => {
          setSelectedWorkOrder(ord.id);
          setReportModalOpen(true);
          setDetailModalOpen(false);
        }}
        canFinishFromDetails={canFinishSelectedFromDetails}
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
