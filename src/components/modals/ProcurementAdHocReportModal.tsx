import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROCUREMENT_AD_HOC_STATUS,
  PROCUREMENT_AD_HOC_STATUS_OPTIONS,
  labelProcurementAdHocStatus,
  normalizeProcurementAdHocStatus,
  procurementAdHocBadgeVariant,
  type ProcurementAdHocStatus,
} from "@/lib/procurement-ad-hoc-status";
import {
  useUpdateProcurementAdHocItemStatus,
  type ProcurementAdHocItem,
} from "@/hooks/use-procurement-ad-hoc-items";
import {
  generateProcurementAdHocPdfForSupplierGroup,
  type ProcurementAdHocPdfRow,
} from "@/lib/procurement-ad-hoc-pdf";
import { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";

type GroupedItems = {
  supplier: string;
  items: ProcurementAdHocItem[];
}[];

function groupBySupplier(items: ProcurementAdHocItem[]): GroupedItems {
  const map = new Map<string, ProcurementAdHocItem[]>();
  for (const it of items) {
    const supplier = it.supplier?.trim() || "Nepoznat dobavljač";
    if (!map.has(supplier)) map.set(supplier, []);
    map.get(supplier)!.push(it);
  }
  return Array.from(map.entries()).map(([supplier, items]) => ({ supplier, items }));
}

function toPdfRow(it: ProcurementAdHocItem): ProcurementAdHocPdfRow {
  return {
    id: it.id,
    orderId: it.orderId,
    description: it.description,
    articleCode: it.articleCode,
    quantity: it.quantity,
    unit: it.unit,
    notes: it.notes,
    barcode: it.barcode,
    supplier: it.supplier ?? null,
    createdAt: it.createdAt,
    workOrder: it.workOrder,
    position: it.position,
    color: it.color,
    lengthMm: it.lengthMm,
  };
}

export function ProcurementAdHocReportModal({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: ProcurementAdHocItem[];
}) {
  const statusMut = useUpdateProcurementAdHocItemStatus();
  const [pdfBusySupplier, setPdfBusySupplier] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (open) setDragOffset({ x: 0, y: 0 });
  }, [open]);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && window.innerWidth >= 768) return;
    setDragging(true);
    setDragStart({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStart) return;
    setDragOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    setDragStart(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const grouped = useMemo(() => groupBySupplier(items), [items]);

  const openPdfForSupplierGroup = async (supplierLabel: string, group: ProcurementAdHocItem[]) => {
    if (group.length === 0) return;
    setPdfBusySupplier(supplierLabel);
    try {
      const result = await generateProcurementAdHocPdfForSupplierGroup(
        group.map(toPdfRow),
        supplierLabel,
      );
      openPdfBlobInNewTabOrDownload(result.blob, result.filename);
      toast.success("PDF je otvoren u novom tabu.");
    } catch (e) {
      toast.error("Generisanje PDF-a nije uspelo", {
        description: e instanceof Error ? e.message : "Nepoznata greška.",
      });
    } finally {
      setPdfBusySupplier(null);
    }
  };

  if (items.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(92dvh,36rem)] w-[min(96vw,48rem)] overflow-hidden border-border/80 p-0 shadow-xl">
          <div style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}>
            <DialogHeader
              className="border-b border-border/70 bg-muted/30 p-6 pb-4 touch-none select-none cursor-grab active:cursor-grabbing"
              onPointerDown={startDrag}
              onPointerMove={onDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <DialogTitle className="text-lg font-semibold">Vanredne stavke nabavke</DialogTitle>
            </DialogHeader>
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-muted-foreground">Nema vanrednih stavki za prikaz.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(92dvh,42rem)] w-[min(96vw,58rem)] overflow-hidden border-border/80 p-0 shadow-xl">
        <div style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}>
          <DialogHeader
            className="border-b border-border/70 bg-muted/30 p-6 pb-4 touch-none select-none cursor-grab active:cursor-grabbing"
            onPointerDown={startDrag}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <DialogTitle className="text-lg font-semibold">Vanredne stavke nabavke</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "stavka čeka" : "stavki čekaju"} prijem — magacin ih prima
                  skeniranjem A-barkoda iz PDF-a.
                </p>
                {grouped.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    PDF po dobavljaču: koristite dugme pored imena (svaki se otvara u novom tabu).
                  </p>
                )}
              </div>
              {grouped.length === 1 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2 self-start bg-background/80"
                  disabled={pdfBusySupplier === grouped[0].supplier}
                  onClick={() => void openPdfForSupplierGroup(grouped[0].supplier, grouped[0].items)}
                >
                  {pdfBusySupplier === grouped[0].supplier ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4" />
                  )}
                  Otvori PDF
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="max-h-[min(72vh,32rem)] overflow-y-auto overscroll-contain">
            <div className="space-y-6 pb-4">
              {grouped.map((group) => (
                <section
                  key={group.supplier}
                  className="mx-6 mt-5 rounded-xl border border-border/70 bg-card/70 p-4 first:mt-4"
                >
                  <div className="mb-4 flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{group.supplier}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.items.length} {group.items.length === 1 ? "stavka" : "stavke"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 bg-background/80 px-2.5 text-xs"
                        disabled={pdfBusySupplier === group.supplier}
                        onClick={() => void openPdfForSupplierGroup(group.supplier, group.items)}
                      >
                        {pdfBusySupplier === group.supplier ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileDown className="h-3.5 w-3.5" />
                        )}
                        PDF
                      </Button>
                      <span className="rounded-full border border-border/70 bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        Dobavljač
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {group.items.map((item) => {
                      const badgeVariant = procurementAdHocBadgeVariant(item.status);
                      const statusLabel = labelProcurementAdHocStatus(item.status);
                      return (
                        <div
                          key={item.id}
                          className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 shadow-sm"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                {item.articleCode ? (
                                  <span className="font-mono text-xs text-muted-foreground">{item.articleCode}</span>
                                ) : null}
                                <span className="font-semibold text-sm">{item.description}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                  {item.quantity} {item.unit}
                                </span>
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                                    badgeVariant === "danger"
                                      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                      : badgeVariant === "warning"
                                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                        : badgeVariant === "success"
                                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                          : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {statusLabel}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/60">
                                  {item.barcode}
                                </span>
                              </div>

                              {item.notes?.trim() && (
                                <p className="mt-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 text-xs italic text-muted-foreground">
                                  {item.notes.trim()}
                                </p>
                              )}

                              {item.attachmentUrl ? (
                                <a
                                  href={item.attachmentUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  <ExternalLink className="h-3 w-3" /> {item.attachmentName ?? "Prilog"}
                                </a>
                              ) : null}
                            </div>

                            <div className="flex items-start gap-2 sm:shrink-0">
                              <Select
                                value={normalizeProcurementAdHocStatus(item.status)}
                                disabled={statusMut.isPending && statusMut.variables?.id === item.id}
                                onValueChange={(v) => {
                                  const next = v as ProcurementAdHocStatus;
                                  if (next === normalizeProcurementAdHocStatus(item.status)) return;
                                  statusMut.mutate(
                                    { id: item.id, status: next },
                                    {
                                      onSuccess: () => {
                                        if (
                                          (next === PROCUREMENT_AD_HOC_STATUS.RECEIVED ||
                                            next === PROCUREMENT_AD_HOC_STATUS.CANCELED) &&
                                          items.length <= 1
                                        ) {
                                          onOpenChange(false);
                                        }
                                      },
                                    },
                                  );
                                }}
                              >
                                <SelectTrigger className="h-8 w-full sm:w-[13rem] text-xs">
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
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
