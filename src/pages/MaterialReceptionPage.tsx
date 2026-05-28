import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Building2, ChevronRight, Download, Loader2, PackageCheck, ScanBarcode, Search } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageTransition } from "@/components/shared/PageTransition";
import { CardListSkeleton } from "@/components/shared/Skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useProcurementComplaintsForOrderIds } from "@/hooks/use-procurement-complaints";
import { useProcurementAdHocItemsForOrderIds } from "@/hooks/use-procurement-ad-hoc-items";
import { isProcurementAdHocActive } from "@/lib/procurement-ad-hoc-status";
import { isProcurementComplaintActive } from "@/lib/procurement-complaint-status";
import { labelDeliveryStatus, labelMaterialType } from "@/lib/activity-labels";
import type { MaterialOrder } from "@/types";
import { filterMaterialReceptionCandidates } from "@/lib/material-reception-candidates";
import { openReceptionActionBarcodesPdf } from "@/lib/reception-action-barcodes-pdf";
import { toast } from "sonner";
import { useRole } from "@/contexts/RoleContext";

/**
 * Centralizovan ekran za sve magacin/proizvodnja korisnike: lista svih porudžbina materijala
 * koje su SPREMNE ZA PRIJEM (waiting_for_delivery, received_with_issues, aktivne porudžbine po nedostatku).
 * Kada postoji aktivna porudžbina po nedostatku, parent narudžbina se ne duplira na listi — prijem je na shortage.
 */
export default function MaterialReceptionPage() {
  const navigate = useNavigate();
  const { currentRole } = useRole();
  const [search, setSearch] = useState("");
  const [actionBarcodesPdfLoading, setActionBarcodesPdfLoading] = useState(false);
  const { orders, isLoading } = useMaterialOrders();

  const handleDownloadActionBarcodesPdf = useCallback(async () => {
    setActionBarcodesPdfLoading(true);
    try {
      await openReceptionActionBarcodesPdf();
      toast.success("PDF barkodova je otvoren.");
    } catch (e) {
      toast.error("Greška pri generisanju PDF-a", {
        description: e instanceof Error ? e.message : "Pokušajte ponovo.",
      });
    } finally {
      setActionBarcodesPdfLoading(false);
    }
  }, []);

  const candidateOrders = useMemo<MaterialOrder[]>(
    () => filterMaterialReceptionCandidates(orders ?? [], currentRole),
    [orders, currentRole],
  );

  const parentsWithActiveShortage = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders ?? []) {
      if (o.isShortageOrder && o.parentOrderId && o.deliveryStatus !== "materials_received") {
        set.add(o.parentOrderId);
      }
    }
    return set;
  }, [orders]);

  const candidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of candidateOrders) {
      ids.add(o.id);
      if (o.isShortageOrder && o.parentOrderId) ids.add(o.parentOrderId);
    }
    return [...ids];
  }, [candidateOrders]);
  const complaintsQuery = useProcurementComplaintsForOrderIds(candidateIds, candidateIds.length > 0);
  const adHocQuery = useProcurementAdHocItemsForOrderIds(candidateIds, candidateIds.length > 0);

  const activeComplaintsByOrder = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of complaintsQuery.data ?? []) {
      if (isProcurementComplaintActive(c.status)) {
        map.set(c.order_id, (map.get(c.order_id) ?? 0) + 1);
      }
    }
    return map;
  }, [complaintsQuery.data]);

  const pendingAdHocByOrder = useMemo(() => {
    const map = new Map<string, number>();
    const grouped = adHocQuery.data ?? {};
    for (const [orderId, items] of Object.entries(grouped)) {
      const pending = items.filter((a) => isProcurementAdHocActive(a.status)).length;
      if (pending > 0) map.set(orderId, pending);
    }
    return map;
  }, [adHocQuery.data]);

  const effectiveAdHocCount = useCallback(
    (o: MaterialOrder) => {
      if (o.isShortageOrder) {
        const own = pendingAdHocByOrder.get(o.id) ?? 0;
        const parent = o.parentOrderId ? pendingAdHocByOrder.get(o.parentOrderId) ?? 0 : 0;
        return own + parent;
      }
      return parentsWithActiveShortage.has(o.id) ? 0 : pendingAdHocByOrder.get(o.id) ?? 0;
    },
    [pendingAdHocByOrder, parentsWithActiveShortage],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return candidateOrders;
    return candidateOrders.filter((o) => {
      const haystack = [
        o.supplier ?? "",
        o.supplierContact ?? "",
        o.job?.jobNumber ?? "",
        labelMaterialType(o.materialType),
        o.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [candidateOrders, search]);

  const sorted = useMemo(() => {
    const priority = (o: MaterialOrder): number => {
      const complaintOrderId = o.isShortageOrder && o.parentOrderId ? o.parentOrderId : o.id;
      const hasIssue =
        (activeComplaintsByOrder.get(complaintOrderId) ?? 0) > 0 || effectiveAdHocCount(o) > 0;
      if (hasIssue) return 0;
      if (o.deliveryStatus === "waiting_for_delivery" || o.deliveryStatus === "received_with_issues") return 1;
      if (o.deliveryStatus === "shipped" || o.deliveryStatus === "delivered" || o.deliveryStatus === "partial") return 2;
      return 3;
    };
    return [...filtered].sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      const jobA = a.job?.jobNumber ?? "";
      const jobB = b.job?.jobNumber ?? "";
      return jobA.localeCompare(jobB);
    });
  }, [filtered, activeComplaintsByOrder, effectiveAdHocCount]);

  if (isLoading) {
    return (
      <AppLayout title="Prijem materijala">
        <CardListSkeleton count={4} />
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Prijem materijala">
      <PageTransition>
        <PageHeader
          title="Prijem materijala"
          description={
            currentRole === "production"
              ? "Porudžbine u statusu čeka isporuku, primljeno sa problemom ili porudžbina po nedostatku. Nabavni statusi (poslato dobavljaču, čeka plaćanje) nisu na ovoj listi."
              : "Porudžbine spremne za prijem (čeka isporuku, primljeno sa problemom, porudžbina po nedostatku). Kod nadoknade lista pokazuje samo shortage porudžbinu."
          }
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 shrink-0"
              disabled={actionBarcodesPdfLoading}
              onClick={() => void handleDownloadActionBarcodesPdf()}
            >
              {actionBarcodesPdfLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              PDF barkodova magacina
            </Button>
          }
        />

        <div className="mb-4 max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              placeholder="Pretraži po dobavljaču, poslu, materijalu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {sorted.length === 0 ? (
          <Card className="border-border/70 bg-muted/30">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <PackageCheck className="h-6 w-6" aria-hidden />
              </div>
              <p className="text-sm font-medium text-foreground">Trenutno nema porudžbina za prijem</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Lista se popunjava kada porudžbina čeka isporuku ili je primljena sa problemom, kada postoji aktivna
                porudžbina po nedostatku (parent se ne duplira), ili kada su na narudžbini aktivne reklamacije / vanredne
                stavke za prijem.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {sorted.map((o) => {
              const complaintOrderId = o.isShortageOrder && o.parentOrderId ? o.parentOrderId : o.id;
              const issues =
                (activeComplaintsByOrder.get(complaintOrderId) ?? 0) + effectiveAdHocCount(o);
              const isWaiting = o.deliveryStatus === "waiting_for_delivery";
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/order-reception/${o.id}`)}
                    className="flex w-full items-stretch gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
                  >
                    <div
                      className={
                        "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 " +
                        (isWaiting
                          ? "bg-primary/15 text-primary ring-primary/30"
                          : "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-200")
                      }
                    >
                      <ScanBarcode className="h-5 w-5" aria-hidden />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        <span className="text-sm font-semibold text-foreground">
                          {o.supplier?.trim() || "Bez dobavljača"}
                        </span>
                        {o.job?.jobNumber ? (
                          <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                            {o.job.jobNumber}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-foreground">{labelMaterialType(o.materialType)}</span>
                        {o.isShortageOrder ? (
                          <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200">
                            Porudžbina po nedostatku
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Status:</span>
                        <span className="font-medium text-foreground">{labelDeliveryStatus(o.deliveryStatus)}</span>
                        {issues > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            <AlertCircle className="h-3 w-3" aria-hidden /> {issues} problem(a) na čekanju
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <ChevronRight className="my-auto h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6 flex justify-end">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Nazad na kontrolnu tablu</Link>
          </Button>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
