import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, ChevronRight, PackageCheck, ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMaterialOrders } from "@/hooks/use-material-orders";
import { useProcurementComplaintsForOrderIds } from "@/hooks/use-procurement-complaints";
import { useProcurementAdHocItemsForOrderIds } from "@/hooks/use-procurement-ad-hoc-items";
import { isProcurementAdHocActive } from "@/lib/procurement-ad-hoc-status";
import { isProcurementComplaintActive } from "@/lib/procurement-complaint-status";
import { labelDeliveryStatus, labelMaterialType } from "@/lib/activity-labels";
import type { MaterialOrder } from "@/types";
import {
  filterMaterialReceptionCandidates,
  parentOrderIdsWithActiveShortage,
} from "@/lib/material-reception-candidates";
import { useRole } from "@/contexts/RoleContext";

/**
 * Dugme „Prijem materijala za ovaj posao" — vidljivo magacinu (production) i nabavci.
 * Ako postoji tačno jedna porudžbina koja čeka prijem ili reklamacije / vanredne stavke,
 * klikom direktno otvara `/order-reception/<id>`. Ako ih ima više, prikazuje listu.
 */
export function JobReceptionLauncher({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const { currentRole } = useRole();
  const { orders, isLoading, ordersError } = useMaterialOrders(jobId);

  const candidateOrders = useMemo<MaterialOrder[]>(
    () => filterMaterialReceptionCandidates(orders ?? [], currentRole),
    [orders, currentRole],
  );

  const parentsWithActiveShortage = useMemo(
    () => parentOrderIdsWithActiveShortage(orders ?? []),
    [orders],
  );

  /** Reklamacije / vanredne stavke se gledaju samo za narudžbine sa stranice (manji upit). */
  const candidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of candidateOrders) {
      ids.add(o.id);
      if (o.isShortageOrder && o.parentOrderId) ids.add(o.parentOrderId);
    }
    return [...ids];
  }, [candidateOrders]);

  const complaintsQuery = useProcurementComplaintsForOrderIds(
    candidateIds,
    candidateIds.length > 0,
  );
  const adHocQuery = useProcurementAdHocItemsForOrderIds(
    candidateIds,
    candidateIds.length > 0,
  );

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

  /** Efektivni broj otvorenih ad-hoc stavki za prikaz na kartici prijema. */
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

  /** Sortiranje: prvo problemi → spremno za prijem → u tranzitu → pre-shipping. */
  const sortedOrders = useMemo(() => {
    const priority = (o: MaterialOrder): number => {
      const complaintOrderId = o.isShortageOrder && o.parentOrderId ? o.parentOrderId : o.id;
      const hasIssue =
        (activeComplaintsByOrder.get(complaintOrderId) ?? 0) > 0 || effectiveAdHocCount(o) > 0;
      if (hasIssue) return 0;
      if (o.deliveryStatus === "waiting_for_delivery" || o.deliveryStatus === "received_with_issues") return 1;
      if (o.deliveryStatus === "shipped" || o.deliveryStatus === "delivered" || o.deliveryStatus === "partial") return 2;
      return 3;
    };
    return [...candidateOrders].sort((a, b) => priority(a) - priority(b));
  }, [candidateOrders, activeComplaintsByOrder, effectiveAdHocCount]);

  if (isLoading) {
    return (
      <Card className="overflow-hidden border-primary/15 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prijem materijala za ovaj posao</CardTitle>
          <CardDescription>Učitavam aktivne porudžbine…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (ordersError) {
    const message = ordersError instanceof Error ? ordersError.message : String(ordersError);
    return (
      <Card className="overflow-hidden border-destructive/35 bg-destructive/[0.06] shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive ring-1 ring-destructive/30">
              <AlertTriangle className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">Pristup porudžbinama materijala blokiran</CardTitle>
              <CardDescription className="text-destructive">
                {message || "Nepoznata RLS greška"}.
                {" "}
                Pokrenite <code className="rounded bg-destructive/10 px-1 py-0.5 text-[11px]">npx supabase db push</code>{" "}
                da biste primenili migraciju za production rolu, pa se odjavite i ponovo prijavite.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (sortedOrders.length === 0) {
    const total = (orders ?? []).length;
    const allReceived = total > 0 && (orders ?? []).every((o) => o.deliveryStatus === "materials_received");
    return (
      <Card className="overflow-hidden border-border/70 bg-muted/30 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <PackageCheck className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-base leading-tight">Prijem materijala za ovaj posao</CardTitle>
              <CardDescription>
                {total === 0
                  ? "Za ovaj posao još nije kreirana nijedna porudžbina materijala. Nabavka tek treba da je dodá."
                  : allReceived
                    ? "Sve porudžbine materijala za ovaj posao su uredno primljene."
                    : "Trenutno nema porudžbina spremnih za prijem (porudžbine su u draftu ili pre-shipping fazi)."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }

  if (sortedOrders.length === 1) {
    const o = sortedOrders[0];
    const complaintOrderId = o.isShortageOrder && o.parentOrderId ? o.parentOrderId : o.id;
    const issues =
      (activeComplaintsByOrder.get(complaintOrderId) ?? 0) + effectiveAdHocCount(o);
    const isReadyForReception =
      o.deliveryStatus === "waiting_for_delivery" ||
      o.deliveryStatus === "received_with_issues" ||
      o.deliveryStatus === "shipped" ||
      o.deliveryStatus === "delivered" ||
      o.deliveryStatus === "partial" ||
      o.isShortageOrder === true;
    return (
      <Card className="overflow-hidden border-primary/30 bg-primary/[0.04] shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
              <ScanBarcode className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base leading-tight">Prijem materijala za ovaj posao</CardTitle>
              <CardDescription>
                {o.supplier?.trim() ?? "Dobavljač"} · {labelMaterialType(o.materialType)} ·{" "}
                {labelDeliveryStatus(o.deliveryStatus)}
                {o.isShortageOrder ? " · Porudžbina po nedostatku" : ""}
                {issues > 0 ? ` · ${issues} aktivni problem(a)` : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Button
            type="button"
            size="lg"
            variant={isReadyForReception ? "default" : "outline"}
            className="w-full gap-2 sm:w-auto"
            onClick={() => navigate(`/order-reception/${o.id}`)}
          >
            <ScanBarcode className="h-4 w-4" aria-hidden />
            {isReadyForReception ? "Otvori prijem" : "Otvori pregled (još nije isporučeno)"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-primary/25 shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <ScanBarcode className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base leading-tight">Prijem materijala za ovaj posao</CardTitle>
            <CardDescription>
              Posao ima više porudžbina spremnih za prijem. Odaberite koju otvarate.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {sortedOrders.map((o) => {
          const complaintOrderId = o.isShortageOrder && o.parentOrderId ? o.parentOrderId : o.id;
          const issues =
            (activeComplaintsByOrder.get(complaintOrderId) ?? 0) + effectiveAdHocCount(o);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => navigate(`/order-reception/${o.id}`)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.04]"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {o.supplier?.trim() ?? "Dobavljač"} · {labelMaterialType(o.materialType)}
                  {o.isShortageOrder ? (
                    <span className="ml-2 inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:text-amber-200">
                      Porudžbina po nedostatku
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Status: {labelDeliveryStatus(o.deliveryStatus)}
                  {issues > 0 ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                      <AlertCircle className="h-3 w-3" aria-hidden /> {issues} aktivni problem(a)
                    </span>
                  ) : null}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
