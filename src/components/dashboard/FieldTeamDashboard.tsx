import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Calendar, MapPin, Phone,
  Plus,
  Loader2, Hammer
} from "lucide-react";
import { format } from "date-fns";
import { sr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFieldTeamData } from "@/hooks/use-field-team-data";
import { FieldTeamWorkOrdersMap } from "@/components/dashboard/FieldTeamWorkOrdersMap";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import { WorkOrderModal } from "@/components/modals/WorkOrderModal";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import type { WorkOrder, WorkOrderType } from "@/types";
import { useRole } from "@/contexts/RoleContext";
import { fieldReportFlowForWorkOrderType } from "@/lib/field-team-access";
import { useAuthStore } from "@/stores/auth-store";
import { labelWorkOrderType } from "@/lib/activity-labels";

export function FieldTeamDashboard() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { canPerformAction } = useRole();
  const { workOrders, isLoading } = useFieldTeamData();
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | null>(null);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | undefined>(undefined);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const { toast } = useToast();
  const statusLabels: Record<string, string> = {
    pending: "Na čekanju",
    in_progress: "U toku",
    completed: "Završen",
    canceled: "Otkazan",
  };

  const getCustomerPhone = (customer: WorkOrder["job"] extends infer T ? T extends { customer?: infer C } ? C : never : never) => {
    if (!customer) return undefined;
    if (Array.isArray(customer)) {
      return customer[0]?.phones?.[0];
    }
    return customer.phones?.[0];
  };

  const handleOpenDetails = (wo: WorkOrder) => {
    setSelectedWO(wo);
    setDetailModalOpen(true);
  };

  const openInGoogleMaps = (address: string) => {
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleStatusUpdate = async (workOrderId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("work_orders")
        .update({ status: newStatus })
        .eq("id", workOrderId);

      if (error) throw error;

      await queryClient.invalidateQueries({
        queryKey: ["field-team-work-orders", user?.teamId, user?.role],
      });
      await queryClient.invalidateQueries({ queryKey: ["field-team-map-markers"] });

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
  const activeWorkOrder = workOrders?.find((wo) => wo.status === "in_progress");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Moji radni nalozi</h2>
          <p className="text-muted-foreground">Pregled dodeljenih zadataka za vaš tim.</p>
        </div>
      </div>

      {workOrders && workOrders.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workOrders.map((wo) => (
            <Card 
              key={wo.id} 
              className="overflow-hidden border-l-4 border-l-primary hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => handleOpenDetails(wo)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <Badge
                      variant={wo.status === "completed" ? "secondary" : "outline"}
                      className={
                        wo.status === "completed"
                          ? "border-transparent bg-emerald-600/15 text-emerald-800 dark:text-emerald-400"
                          : wo.status === "in_progress"
                            ? "border-primary/40 text-primary"
                            : undefined
                      }
                    >
                      {wo.status === 'completed' ? 'Završeno' : wo.status === 'in_progress' ? 'U toku' : 'Na čekanju'}
                    </Badge>
                    <CardTitle className="text-lg">
                      {labelWorkOrderType(wo.type)}
                    </CardTitle>
                    <CardDescription>{wo.job?.jobNumber}</CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center text-sm font-medium">
                      <Calendar className="mr-1 h-3 w-3" />
                      {wo.date ? format(new Date(wo.date), "dd. MMM", { locale: sr }) : "Nije zakazano"}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-1">
                      <span>{wo.job?.installationAddress || "Nema adrese"}</span>
                      {wo.job?.installationAddress && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            openInGoogleMaps(wo.job!.installationAddress!);
                          }}
                          className="text-[10px] text-primary hover:underline font-semibold text-left"
                        >
                          Otvori u Google Mapama
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <Phone className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
                    <a href={`tel:${getCustomerPhone(wo.job?.customer) ?? ""}`} className="text-primary hover:underline">
                      {getCustomerPhone(wo.job?.customer) || "Nema telefona"}
                    </a>
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Opis posla</p>
                  <p className="text-sm line-clamp-2">{wo.description || "Nema opisa"}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  {wo.status !== 'completed' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      disabled={wo.status === "pending" && !!activeWorkOrder && activeWorkOrder.id !== wo.id}
                      title={
                        wo.status === "pending" && !!activeWorkOrder && activeWorkOrder.id !== wo.id
                          ? "Završite aktivni nalog pre pokretanja sledećeg."
                          : undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (wo.status === "pending") {
                          handleStatusUpdate(wo.id, "in_progress");
                          return;
                        }
                        if (wo.status === "in_progress") {
                          setSelectedWorkOrder(wo.id);
                          setReportModalOpen(true);
                        }
                      }}
                    >
                      {wo.status === 'pending' ? 'Započni' : 'Završi'}
                    </Button>
                  )}
                  {(() => {
                    const flow = fieldReportFlowForWorkOrderType(wo.type as WorkOrderType);
                    const canReport =
                      (flow === "mounting" && canPerformAction("add_mounting_report")) ||
                      (flow === "field" && canPerformAction("add_field_report"));
                    if (!canReport) return null;
                    return (
                      <Button 
                        variant="default" 
                        size="sm" 
                        className="w-full"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWorkOrder(wo.id);
                          setReportModalOpen(true);
                        }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Izveštaj
                      </Button>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 bg-muted/30 rounded-xl border border-dashed border-border">
          <Hammer className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="font-semibold text-lg">Nema dodeljenih naloga</h3>
          <p className="text-muted-foreground">Trenutno nemate aktivnih radnih naloga.</p>
        </div>
      )}

      <FieldTeamWorkOrdersMap workOrders={workOrders ?? []} onOpenWorkOrder={handleOpenDetails} />

      {selectedWorkOrder && (
        <NewFieldReportModal 
          open={reportModalOpen} 
          onOpenChange={setReportModalOpen}
          workOrderId={selectedWorkOrder}
        />
      )}

      <WorkOrderModal 
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        onSave={() => {}} // Read-only
        order={selectedWO}
        readOnly={true}
      />
    </div>
  );
}
