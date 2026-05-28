import type { UrgentSiteMissingProcurementTriage } from "@/hooks/use-urgent-site-missing-notifications";

/** Statusi shortage MO „hitno sa ugradnje” kada magacin sme da radi prijem. */
export const SITE_HIT_SHORTAGE_RECEPTION_STATUSES = ["waiting_for_delivery", "received_with_issues"] as const;

export type SiteHitShortageReceptionStatus = (typeof SITE_HIT_SHORTAGE_RECEPTION_STATUSES)[number];

export function siteHitShortageCanShowReception(
  deliveryStatus: string | null | undefined,
): deliveryStatus is SiteHitShortageReceptionStatus {
  if (!deliveryStatus) return false;
  return (SITE_HIT_SHORTAGE_RECEPTION_STATUSES as readonly string[]).includes(deliveryStatus);
}

/** Faza na dashboard alertu (novi tok — samo `material_orders.delivery_status`). */
export type InvoiceMissingProcurementUiPhase =
  | "preparing"
  | "in_procurement"
  | "awaiting_delivery"
  | "awaiting_production"
  | "received_with_issues";

export function invoiceMissingProcurementUiPhase(
  triage: UrgentSiteMissingProcurementTriage | null,
): InvoiceMissingProcurementUiPhase | null {
  if (!triage || triage.adHocItemId) return null;
  const ds = triage.shortageDeliveryStatus ?? "";
  if (!ds) return null;

  if (triage.awaitingProduction && ds === "materials_received" && triage.requiresProduction) {
    return "awaiting_production";
  }
  if (ds === "received_with_issues") return "received_with_issues";
  if (
    ds === "waiting_for_delivery" ||
    ds === "shipped" ||
    ds === "delivered" ||
    ds === "partial"
  ) {
    return "awaiting_delivery";
  }
  if (ds === "sent_to_supplier" || ds === "waiting_for_payment") return "in_procurement";
  if (ds !== "materials_received") return "preparing";
  return null;
}

export const INVOICE_MISSING_PROCUREMENT_PHASE_LABEL: Record<InvoiceMissingProcurementUiPhase, string> = {
  preparing: "Nabavka — priprema",
  in_procurement: "U nabavci",
  awaiting_delivery: "Čeka isporuku",
  awaiting_production: "Čeka proizvodnju",
  received_with_issues: "Prijem sa problemom",
};

/** „Proizvedeno — Zakaži ugradnju” samo posle ispravnog prijema robe u magacin. */
export function invoiceMissingShowProductionButton(
  canConfirm: boolean,
  jobId: string | null | undefined,
  position: string | null | undefined,
  triage: UrgentSiteMissingProcurementTriage | null,
): boolean {
  if (!canConfirm || !jobId || !position || !triage?.awaitingProduction) return false;

  if (triage.adHocItemId) {
    return triage.adHocStatus === "received" && triage.vrstaStavke === "sirovine_za_proizvodnju";
  }

  return (
    triage.requiresProduction &&
    triage.shortageDeliveryStatus === "materials_received"
  );
}

export function materialOrderSiteHitShowsReceptionBarcode(
  deliveryStatus: string,
  hasReceivableLines: boolean,
): boolean {
  return hasReceivableLines && siteHitShortageCanShowReception(deliveryStatus);
}
