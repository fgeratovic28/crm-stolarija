import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Package, CheckCircle, Truck, Clock, Edit2, Trash2, FileText, Upload, Printer, ExternalLink, ClipboardList, Loader2 } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { DelayedDeliveryBadge } from "@/components/shared/OperationalBadges";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useRole } from "@/contexts/RoleContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialOrderForm } from "@/components/shared/MaterialOrderForm";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useMaterialOrderAttachments } from "@/hooks/use-material-order-files";
import { useFiles } from "@/hooks/use-files";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import type { AppFile, MaterialOrder } from "@/types";
import type { MaterialOrderFormValues } from "@/components/shared/MaterialOrderForm";
import { labelMaterialType } from "@/lib/activity-labels";
import { exportMaterialOrderPDF } from "@/lib/export-documents";
import { mergeDefined } from "@/lib/merge-defined";
import { NarudzbenicaQuickEditDialog } from "@/components/modals/NarudzbenicaQuickEditDialog";

const deliveryVariant: Record<string, "success" | "warning" | "info" | "muted"> = {
  delivered: "success",
  shipped: "info",
  pending: "warning",
  partial: "muted",
};

const deliveryLabels: Record<string, string> = {
  delivered: "Isporučeno",
  shipped: "Na putu",
  pending: "Na čekanju",
  partial: "Delimično",
};

export function MaterialOrdersTab({ orders: initialOrders, jobId }: { orders?: MaterialOrder[]; jobId?: string }) {
  const formatCurrency = (n: number) => formatCurrencyBySettings(n);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canPerformAction } = useRole();
  const { createOrder, updateOrder, deleteOrder, orders: hookedOrders, isLoading: ordersLoading } = useMaterialOrders(jobId);
  const { uploadFile, deleteFile } = useFiles();
  const { user } = useAuthStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<MaterialOrder | null>(null);
  const [nbQuickOrder, setNbQuickOrder] = useState<MaterialOrder | null>(null);

  const displayOrders = initialOrders || hookedOrders || [];
  const isLoading = !initialOrders && ordersLoading;

  const orderIds = displayOrders.map((o) => o.id);
  const { data: attachmentsByOrder = {}, isLoading: attachmentsLoading } = useMaterialOrderAttachments(orderIds);

  const handleCreate = (data: MaterialOrderFormValues) => {
    createOrder.mutate(data, {
      onSuccess: () => setIsModalOpen(false),
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

  const handleExportPdf = async (order: MaterialOrder) => {
    try {
      await exportMaterialOrderPDF(order, {
        attachGeneratedPdf: !!user?.id,
        userId: user?.id,
        onPdfAttached: (result) => {
          queryClient.invalidateQueries({ queryKey: ["material-order-files"] });
          if (result === "updated") {
            toast.success("PDF narudžbine je ažuriran u prilozima");
          } else {
            toast.success("PDF narudžbine je sačuvan u priloge");
          }
        },
        onPdfAttachFailed: (m) =>
          toast.error("Štampa je otvorena, ali PDF nije sačuvan kao prilog", { description: m }),
      });
    } catch {
      toast.error("Greška pri generisanju dokumenta za štampu");
    }
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
        <EmptyState
          icon={Package}
          title="Nema narudžbina materijala"
          description="Nema evidentiranih narudžbina za trenutne filtere ili posao."
          actionLabel={canPerformAction("create_order") ? "Nova narudžbina" : undefined}
          onAction={openCreate}
        />
      ) : (
        <div className="grid gap-4">
          {displayOrders.map((o) => {
            const relatedJob = o.job;
            const attachments = attachmentsByOrder[o.id] ?? [];
            return (
              <div key={o.id} className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:shadow-sm transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm">{labelMaterialType(o.materialType)}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{o.supplier}</span>
                        {relatedJob && (
                          <button
                            type="button"
                            className="text-primary hover:underline font-medium"
                            onClick={() => navigate(`/jobs/${relatedJob.id}`)}
                          >
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
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="PDF / štampa (jedan prilog po narudžbini — ažurira se pri ponovnoj štampi)"
                        onClick={() => void handleExportPdf(o)}
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </Button>
                      {canPerformAction("create_order") && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Podaci za porudžbenicu (štampa / javni link)"
                            onClick={() => setNbQuickOrder(o)}
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(o)}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(o.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Upit / Naručeno</span>
                    <p className="font-medium">{o.requestDate || o.orderDate}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Očekivano</span>
                    <p className="font-medium">{o.expectedDelivery}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Cena</span>
                    <p className="font-medium">{formatCurrency(o.price || o.supplierPrice)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Kontakt</span>
                    <p className="font-medium text-xs sm:text-sm">{o.supplierContact}</p>
                  </div>
                </div>

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
                  ) : attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nema priloženih fajlova. Štampom se jednom doda PDF porudžbenice (ime fajla po poslu i narudžbini); ponovna štampa ga samo ažurira.</p>
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

                {o.notes && <p className="text-sm text-muted-foreground mt-3 border-t border-border pt-3">{o.notes}</p>}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    {o.deliveryVerified || o.quantityVerified ? (
                      <CheckCircle className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
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
        <DialogContent className="w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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

      <NarudzbenicaQuickEditDialog
        order={nbQuickOrder}
        open={nbQuickOrder !== null}
        onOpenChange={(open) => {
          if (!open) setNbQuickOrder(null);
        }}
        onSave={(patch) => {
          if (!nbQuickOrder) return;
          const merged = mergeDefined(nbQuickOrder, patch as Record<string, unknown>) as MaterialOrder;
          updateOrder.mutate(merged, {
            onSuccess: () => setNbQuickOrder(null),
          });
        }}
        isLoading={updateOrder.isPending}
      />
    </div>
  );
}
