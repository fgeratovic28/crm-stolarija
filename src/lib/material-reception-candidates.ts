import type { MaterialOrder, UserRole } from "@/types";
import { siteHitShortageCanShowReception } from "@/lib/invoice-missing-procurement-phase";

/** Nabavka: porudžbine u toku pre fizičke isporuke (magacin ih ne vodi). */
const PROCUREMENT_PIPELINE_DELIVERY_STATUSES = new Set<MaterialOrder["deliveryStatus"]>([
  "sent_to_supplier",
  "waiting_for_payment",
]);

/** Svi statusi koji mogu biti na listi prijema (nabavka / admin). */
export const MATERIAL_RECEPTION_CANDIDATE_STATUSES = new Set<MaterialOrder["deliveryStatus"]>([
  "sent_to_supplier",
  "waiting_for_payment",
  "waiting_for_delivery",
  "shipped",
  "delivered",
  "partial",
  "received_with_issues",
]);

/** Magacin (proizvodnja): fizički prijem — čeka isporuku i nadoknade / problemi. */
export const PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUSES = new Set<MaterialOrder["deliveryStatus"]>([
  "waiting_for_delivery",
  "received_with_issues",
  "shipped",
  "delivered",
  "partial",
]);

/** Statusi za Supabase `.in()` kada proizvodnja učitava globalnu listu porudžbina. */
export const PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUS_VALUES = [
  ...PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUSES,
] as MaterialOrder["deliveryStatus"][];

function deliveryStatusEligibleForReception(
  deliveryStatus: MaterialOrder["deliveryStatus"],
  role: UserRole | null | undefined,
): boolean {
  if (role === "production") {
    return PRODUCTION_MATERIAL_RECEPTION_DELIVERY_STATUSES.has(deliveryStatus);
  }
  return MATERIAL_RECEPTION_CANDIDATE_STATUSES.has(deliveryStatus);
}

/** Da li jedna porudžbina ulazi u „sirovni“ skup pre skrivanja parent-a kad postoji shortage. */
export function isRawMaterialReceptionCandidate(
  o: MaterialOrder,
  role?: UserRole | null,
): boolean {
  if (o.isShortageOrder && o.siteMissingFromInstallation) {
    return siteHitShortageCanShowReception(o.deliveryStatus);
  }
  if (o.isShortageOrder && o.deliveryStatus !== "materials_received") return true;
  return deliveryStatusEligibleForReception(o.deliveryStatus, role);
}

/** Parent ID-evi koji imaju aktivnu shortage child porudžbinu. */
export function parentOrderIdsWithActiveShortage(orders: MaterialOrder[]): Set<string> {
  const set = new Set<string>();
  for (const o of orders) {
    if (o.isShortageOrder && o.parentOrderId && o.deliveryStatus !== "materials_received") {
      set.add(o.parentOrderId);
    }
  }
  return set;
}

/**
 * Lista porudžbina za ekran Prijem materijala.
 * Proizvodnja vidi „čeka isporuku“ i povezane statuse prijema, ne nabavni pipeline (poslato dobavljaču / čeka plaćanje).
 */
export function filterMaterialReceptionCandidates(
  orders: MaterialOrder[],
  role?: UserRole | null,
): MaterialOrder[] {
  const raw = orders.filter((o) => isRawMaterialReceptionCandidate(o, role));
  const parentsWithActiveShortage = parentOrderIdsWithActiveShortage(orders);
  return raw.filter((o) => {
    if (!o.isShortageOrder && parentsWithActiveShortage.has(o.id)) return false;
    return true;
  });
}

/** Da li je status isključivo nabavni pipeline (informativno za UI). */
export function isProcurementPipelineDeliveryStatus(status: MaterialOrder["deliveryStatus"]): boolean {
  return PROCUREMENT_PIPELINE_DELIVERY_STATUSES.has(status);
}
