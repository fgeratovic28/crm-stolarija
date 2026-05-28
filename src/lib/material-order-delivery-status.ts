import type { MaterialOrder } from "@/types";
import { labelDeliveryStatus } from "@/lib/activity-labels";

/** Statusi u aktivnom nabavnom toku (bez legacy shipped / delivered / partial). */
export const MATERIAL_ORDER_ACTIVE_DELIVERY_STATUSES = [
  "pending",
  "email_sent",
  "sent_to_supplier",
  "waiting_for_payment",
  "waiting_for_delivery",
  "materials_received",
  "received_with_issues",
] as const satisfies readonly MaterialOrder["deliveryStatus"][];

/** Legacy — ostaju u bazi / SEF-u, ne nude se pri kreiranju. */
export const MATERIAL_ORDER_LEGACY_DELIVERY_STATUSES = [
  "shipped",
  "delivered",
  "partial",
] as const;

export type MaterialOrderActiveDeliveryStatus = (typeof MATERIAL_ORDER_ACTIVE_DELIVERY_STATUSES)[number];

/** Ručno pri kreiranju — do faze „čeka isporuku” (prijem postavlja magacin). */
export const MATERIAL_ORDER_CREATE_DELIVERY_STATUSES = [
  "pending",
  "email_sent",
  "sent_to_supplier",
  "waiting_for_payment",
  "waiting_for_delivery",
] as const satisfies readonly MaterialOrderActiveDeliveryStatus[];

function toSelectOptions(values: readonly string[]): { value: string; label: string }[] {
  return values.map((value) => ({
    value,
    label: labelDeliveryStatus(value),
  }));
}

/** Padajući meni pri kreiranju narudžbine — aktivni statusi do isporuke. */
export function materialOrderDeliveryStatusCreateOptions(): { value: string; label: string }[] {
  return toSelectOptions(MATERIAL_ORDER_CREATE_DELIVERY_STATUSES);
}

/**
 * Padajući meni pri izmeni: aktivni statusi + legacy samo ako je to trenutna vrednost narudžbine.
 */
export function materialOrderDeliveryStatusEditOptions(
  currentStatus?: MaterialOrder["deliveryStatus"] | string | null,
): { value: string; label: string }[] {
  const values = new Set<string>(MATERIAL_ORDER_ACTIVE_DELIVERY_STATUSES);
  const cur = String(currentStatus ?? "").trim();
  if (
    cur &&
    (MATERIAL_ORDER_LEGACY_DELIVERY_STATUSES as readonly string[]).includes(cur) &&
    !values.has(cur)
  ) {
    values.add(cur);
  }
  return toSelectOptions(Array.from(values));
}
