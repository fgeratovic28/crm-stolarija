import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FileDown, Loader2 } from "lucide-react";
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
  PROCUREMENT_COMPLAINT_STATUS,
  PROCUREMENT_COMPLAINT_STATUS_OPTIONS,
  isProcurementComplaintActive,
  labelProcurementComplaintStatus,
  normalizeProcurementComplaintStatus,
  procurementComplaintBadgeVariant,
  type ProcurementComplaintStatus,
} from "@/lib/procurement-complaint-status";
import {
  useUpdateProcurementComplaintStatus,
  type ProcurementComplaintWithOrder,
} from "@/hooks/use-procurement-complaints";
import {
  generateProcurementComplaintPdfForSupplierGroup,
  type ProcurementComplaintPdfRow,
} from "@/lib/procurement-complaint-pdf";
import { openPdfBlobInNewTabOrDownload } from "@/lib/pdf-from-html";

function formatItemDetail(d: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (label: string, key: string) => {
    const v = d[key];
    if (v == null || String(v).trim() === "") return;
    parts.push(`${label}: ${String(v)}`);
  };
  push("Šifra", "article_code");
  push("Artikal", "article");
  push("Boja", "color");
  push("JM", "uom");
  push("Nedostaje", "missing_qty");
  push("Oštećeno", "damaged_qty");
  push("Napomena", "notes");
  push("Nalog", "work_order");
  push("Poz.", "position");
  return parts.join(" · ") || JSON.stringify(d);
}

type GroupedComplaints = {
  supplier: string;
  complaints: ProcurementComplaintWithOrder[];
}[];

function groupComplaintsBySupplier(complaints: ProcurementComplaintWithOrder[]): GroupedComplaints {
  const map = new Map<string, ProcurementComplaintWithOrder[]>();
  for (const c of complaints) {
    const supplier = c.supplier?.trim() || "Nepoznat dobavljač";
    if (!map.has(supplier)) map.set(supplier, []);
    map.get(supplier)!.push(c);
  }
  return Array.from(map.entries()).map(([supplier, complaints]) => ({ supplier, complaints }));
}

function complaintToPdfRow(c: ProcurementComplaintWithOrder): ProcurementComplaintPdfRow {
  return {
    id: c.id,
    order_id: c.order_id,
    supplier: c.supplier,
    item_details: (c.item_details && typeof c.item_details === "object" ? c.item_details : {}) as Record<
      string,
      unknown
    >,
    photo_evidence_urls: Array.isArray(c.photo_evidence_urls) ? c.photo_evidence_urls : [],
    created_at: c.created_at,
    barcode: c.barcode ?? null,
  };
}

export function ProcurementDiscrepancyModal({
  open,
  onOpenChange,
  complaints,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  complaints: ProcurementComplaintWithOrder[];
}) {
  const statusMut = useUpdateProcurementComplaintStatus();
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

  const grouped = useMemo(() => groupComplaintsBySupplier(complaints), [complaints]);

  /** Jedan dobavljač = jedan PDF; novi tab tek kad je blob spreman (bez „Generišem…“ stranice). */
  const openPdfForSupplierGroup = async (supplierLabel: string, groupComplaints: ProcurementComplaintWithOrder[]) => {
    if (groupComplaints.length === 0) return;
    setPdfBusySupplier(supplierLabel);
    try {
      const rows = groupComplaints.map(complaintToPdfRow);
      const result = await generateProcurementComplaintPdfForSupplierGroup(rows, supplierLabel);
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
  const activeComplaints = complaints.filter((c) => isProcurementComplaintActive(c.status));

  if (complaints.length === 0) {
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
              <DialogTitle className="text-lg font-semibold">Neslaganja nabavke</DialogTitle>
            </DialogHeader>
            <div className="flex flex-1 items-center justify-center p-8">
              <p className="text-sm text-muted-foreground">Nema reklamacija za prikaz.</p>
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
                <DialogTitle className="text-lg font-semibold">Neslaganja nabavke</DialogTitle>
                {activeComplaints.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {activeComplaints.length} aktivn{activeComplaints.length === 1 ? "a" : "e"} reklamacij
                    {activeComplaints.length === 1 ? "a" : "e"} zahteva rešavanje.
                  </p>
                )}
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
                  onClick={() => void openPdfForSupplierGroup(grouped[0].supplier, grouped[0].complaints)}
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
                <section key={group.supplier} className="mx-6 mt-5 rounded-xl border border-border/70 bg-card/70 p-4 first:mt-4">
                  <div className="mb-4 flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{group.supplier}</p>
                      <p className="text-xs text-muted-foreground">
                        {group.complaints.length} {group.complaints.length === 1 ? "reklamacija" : "reklamacije"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 bg-background/80 px-2.5 text-xs"
                        disabled={pdfBusySupplier === group.supplier}
                        onClick={() => void openPdfForSupplierGroup(group.supplier, group.complaints)}
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
                    {group.complaints.map((complaint) => {
                    const details = (complaint.item_details && typeof complaint.item_details === "object" ? complaint.item_details : {}) as Record<string, unknown>;
                    const missingN = Number(details.missing_qty);
                    const damagedN = Number(details.damaged_qty);
                    const hasMissing = Number.isFinite(missingN) && missingN > 0;
                    const hasDamaged = Number.isFinite(damagedN) && damagedN > 0;
                    const notes = details.notes as string | undefined;
                    const article = details.article as string | undefined;
                    const articleCode = details.article_code as string | undefined;
                    const isActive = isProcurementComplaintActive(complaint.status);
                    const badgeVariant = procurementComplaintBadgeVariant(complaint.status);
                    const statusLabel = labelProcurementComplaintStatus(complaint.status);

                    return (
                      <div
                        key={complaint.id}
                        className={`rounded-xl border p-4 shadow-sm transition-colors ${
                          isActive
                            ? "border-destructive/30 bg-destructive/[0.04]"
                            : "border-border/70 bg-background"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {articleCode && (
                                <span className="font-mono text-xs text-muted-foreground">{articleCode}</span>
                              )}
                              {article ? (
                                <span className="font-semibold text-sm">{article}</span>
                              ) : (
                                <span className="text-sm text-muted-foreground">Nepoznat artikal</span>
                              )}
                            </div>

                            <div className="flex gap-2 flex-wrap mt-2">
                              {hasMissing && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                  Nedostaje: {missingN}
                                </span>
                              )}
                              {hasDamaged && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                                  Oštećeno: {damagedN}
                                </span>
                              )}
                              {!hasMissing && !hasDamaged && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                  Ispravno
                                </span>
                              )}
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
                              {complaint.barcode ? (
                                <span className="font-mono text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/60">
                                  {complaint.barcode}
                                </span>
                              ) : null}
                            </div>

                            {notes?.trim() && (
                              <p className="mt-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 text-xs italic text-muted-foreground">
                                {notes.trim()}
                              </p>
                            )}
                          </div>

                          <div className="flex items-start gap-2 sm:shrink-0">
                            <Select
                              value={normalizeProcurementComplaintStatus(complaint.status)}
                              disabled={statusMut.isPending && statusMut.variables?.complaintId === complaint.id}
                              onValueChange={(v) => {
                                const next = v as ProcurementComplaintStatus;
                                if (next === normalizeProcurementComplaintStatus(complaint.status)) return;
                                statusMut.mutate(
                                  { complaintId: complaint.id, status: next },
                                  {
                                    onSuccess: () => {
                                      const terminal =
                                        next === PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED ||
                                        next === PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED;
                                      if (terminal && complaints.length <= 1) onOpenChange(false);
                                    },
                                  },
                                );
                              }}
                            >
                              <SelectTrigger className="h-8 w-full sm:w-[12rem] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PROCUREMENT_COMPLAINT_STATUS_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value} className="text-xs">
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {complaint.photo_evidence_urls && complaint.photo_evidence_urls.length > 0 && (
                          <div className="mt-3 border-t border-border/60 pt-3">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                              Fotografije
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {complaint.photo_evidence_urls.map((url, idx) => (
                                <a
                                  key={idx}
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border/70 transition-all hover:ring-2 hover:ring-primary"
                                >
                                  <img src={url} alt={`Foto ${idx + 1}`} className="h-full w-full object-cover" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
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
