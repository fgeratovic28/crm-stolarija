import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Package, CheckCircle, Truck, Clock, Edit2, Trash2, FileText, Upload } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { DelayedDeliveryBadge } from "@/components/shared/OperationalBadges";
import { Button } from "@/components/ui/button";
import { useRole } from "@/contexts/RoleContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialOrderForm } from "@/components/shared/MaterialOrderForm";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useFiles } from "@/hooks/use-files";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import type { MaterialOrder } from "@/types";
import type { MaterialOrderFormValues } from "@/components/shared/MaterialOrderForm";

const deliveryVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  delivered: "success", shipped: "info", pending: "warning", partial: "muted",
};

const deliveryLabels: Record<string, string> = {
  delivered: "Isporučeno", shipped: "Na putu", pending: "Na čekanju", partial: "Delimično",
};

export function MaterialOrdersTab({ orders: initialOrders, jobId }: { orders?: MaterialOrder[], jobId?: string }) {
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const navigate = useNavigate();
  const { canPerformAction } = useRole();
  const { createOrder, updateOrder, deleteOrder, orders: hookedOrders, isLoading: ordersLoading } = useMaterialOrders(jobId);
  const { uploadFile } = useFiles();
  const { user } = useAuthStore();
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<MaterialOrder | null>(null);

  const displayOrders = initialOrders || hookedOrders || [];
  const isLoading = !initialOrders && ordersLoading;

  const handleCreate = (data: MaterialOrderFormValues) => {
    createOrder.mutate(data, {
      onSuccess: () => setIsModalOpen(false),
    });
  };

  const handleUpdate = (data: MaterialOrderFormValues) => {
    if (editingOrder) {
      updateOrder.mutate({ ...editingOrder, ...data }, {
        onSuccess: () => {
          setIsModalOpen(false);
          setEditingOrder(null);
        },
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Da li ste sigurni da želite da obrišete ovu narudžbinu?")) {
      deleteOrder.mutate(id);
    }
  };

  const openEdit = (order: MaterialOrder) => {
    setEditingOrder(order);
    setIsModalOpen(true);
  };

  const openCreate = () => {
    setEditingOrder(null);
    setIsModalOpen(true);
  };

  const openFilePicker = (order: MaterialOrder, target: "request" | "quote") => {
    if (!canPerformAction("upload_file")) return;
    if (!user) {
      toast.error("Morate biti prijavljeni");
      return;
    }

    const effectiveJobId = order.jobId || jobId;
    if (!effectiveJobId) {
      toast.error("Nije moguće otpremiti fajl bez povezanog posla");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp";

    input.onchange = async (event) => {
      const selectedFile = (event.target as HTMLInputElement).files?.[0];
      if (!selectedFile) return;

      try {
        await uploadFile.mutateAsync({
          jobId: effectiveJobId,
          category: "offers",
          file: selectedFile,
          uploadedBy: user.id,
        });

        const nextOrder: MaterialOrder = {
          ...order,
          requestFile: target === "request" ? selectedFile.name : order.requestFile,
          quoteFile: target === "quote" ? selectedFile.name : order.quoteFile,
        };
        await updateOrder.mutateAsync(nextOrder);
      } catch {
        // Hooks already display error toast.
      }
    };

    input.click();
  };

  return (
    <div>
      <SectionHeader
        title="Narudžbine materijala"
        subtitle={`${displayOrders.length} narudžbin${displayOrders.length === 1 ? "a" : "e"}`}
        icon={Package}
        actions={canPerformAction("create_order") ? <Button size="sm" onClick={openCreate}>Nova narudžbina</Button> : undefined}
      />
      {isLoading ? (
        <CardListSkeleton count={3} />
      ) : displayOrders.length === 0 ? (
        <EmptyState icon={Package} title="Nema narudžbina materijala" description="Nema evidentiranih narudžbina za trenutne filtere ili posao." actionLabel={canPerformAction("create_order") ? "Nova narudžbina" : undefined} onAction={openCreate} />
      ) : (
        <div className="grid gap-4">
          {displayOrders.map((o) => {
            const relatedJob = o.job;
            return (
              <div key={o.id} className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:shadow-sm transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground capitalize text-sm">{o.materialType.replace("_", " ")}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{o.supplier}</span>
                        {relatedJob && (
                          <button className="text-primary hover:underline font-medium" onClick={() => navigate(`/jobs/${relatedJob.id}`)}>
                            {relatedJob.jobNumber}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <GenericBadge label={deliveryLabels[o.deliveryStatus]} variant={deliveryVariant[o.deliveryStatus]} />
                    <GenericBadge label={o.paid ? "Plaćeno" : "Neplaćeno"} variant={o.paid ? "success" : "danger"} />
                    <DelayedDeliveryBadge order={o} />
                    {canPerformAction("create_order") && (
                      <div className="flex items-center gap-1 ml-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(o)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(o.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-muted-foreground text-xs">Upit / Naručeno</span><p className="font-medium">{o.requestDate || o.orderDate}</p></div>
                  <div><span className="text-muted-foreground text-xs">Očekivano</span><p className="font-medium">{o.expectedDelivery}</p></div>
                  <div><span className="text-muted-foreground text-xs">Cena</span><p className="font-medium">{formatCurrency(o.price || o.supplierPrice)}</p></div>
                  <div><span className="text-muted-foreground text-xs">Kontakt</span><p className="font-medium text-xs sm:text-sm">{o.supplierContact}</p></div>
                </div>
                
                <div className="flex items-center gap-3 mt-4 border-t border-border pt-3">
                   <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-[10px] font-medium text-muted-foreground">
                      <FileText className="w-3 h-3" />
                      UPIT: {o.requestFile ? <span className="text-primary cursor-pointer hover:underline">{o.requestFile}</span> : "Nije priložen"}
                      {canPerformAction("upload_file") && !o.requestFile && (
                        <button
                          type="button"
                          className="inline-flex"
                          onClick={() => openFilePicker(o, "request")}
                          disabled={uploadFile.isPending || updateOrder.isPending}
                          aria-label="Otpremi upit"
                        >
                          <Upload className="w-3 h-3 cursor-pointer hover:text-primary" />
                        </button>
                      )}
                   </div>
                   <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-[10px] font-medium text-muted-foreground">
                      <FileText className="w-3 h-3" />
                      PONUDA: {o.quoteFile ? <span className="text-primary cursor-pointer hover:underline">{o.quoteFile}</span> : "Nije priložen"}
                      {canPerformAction("upload_file") && !o.quoteFile && (
                        <button
                          type="button"
                          className="inline-flex"
                          onClick={() => openFilePicker(o, "quote")}
                          disabled={uploadFile.isPending || updateOrder.isPending}
                          aria-label="Otpremi ponudu"
                        >
                          <Upload className="w-3 h-3 cursor-pointer hover:text-primary" />
                        </button>
                      )}
                   </div>
                </div>

                {o.notes && <p className="text-sm text-muted-foreground mt-3 border-t border-border pt-3">{o.notes}</p>}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    {(o.deliveryVerified || o.quantityVerified) ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <Clock className="w-3.5 h-3.5" />}
                    Isporuka verifikovana
                  </span>
                  <span className="flex items-center gap-1">
                    {o.allDelivered ? <CheckCircle className="w-3.5 h-3.5 text-success" /> : <Truck className="w-3.5 h-3.5" />}
                    Sve isporučeno
                  </span>
                  {o.barcode && <span>Barkod: {o.barcode}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingOrder ? "Izmena narudžbine" : "Nova narudžbina"}</DialogTitle>
          </DialogHeader>
          <MaterialOrderForm
            jobId={jobId}
            initialData={editingOrder || {}}
            onSubmit={editingOrder ? handleUpdate : handleCreate}
            onCancel={() => setIsModalOpen(false)}
            isLoading={createOrder.isPending || updateOrder.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
