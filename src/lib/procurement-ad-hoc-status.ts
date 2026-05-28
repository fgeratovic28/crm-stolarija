/**
 * Statusi vanrednih stavki nabavke (`procurement_ad_hoc_items.status`).
 *
 * Tok: `needs_order` → `ordered` → `received`.  Terminal: `canceled`.
 * Reklamacije (`procurement_complaints.status`) imaju zaseban skup vrednosti — videti
 * `procurement-complaint-status.ts`.
 */

export const PROCUREMENT_AD_HOC_STATUS = {
  NEEDS_ORDER: "needs_order",
  ORDERED: "ordered",
  RECEIVED: "received",
  CANCELED: "canceled",
} as const;

export type ProcurementAdHocStatus =
  (typeof PROCUREMENT_AD_HOC_STATUS)[keyof typeof PROCUREMENT_AD_HOC_STATUS];

export const PROCUREMENT_AD_HOC_STATUS_VALUES: ProcurementAdHocStatus[] = [
  PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER,
  PROCUREMENT_AD_HOC_STATUS.ORDERED,
  PROCUREMENT_AD_HOC_STATUS.RECEIVED,
  PROCUREMENT_AD_HOC_STATUS.CANCELED,
];

/** Opcije za padajući meni — redosled prati životni ciklus. */
export const PROCUREMENT_AD_HOC_STATUS_OPTIONS: { value: ProcurementAdHocStatus; label: string }[] = [
  { value: PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER, label: "Treba poručiti" },
  { value: PROCUREMENT_AD_HOC_STATUS.ORDERED, label: "Naručeno / Čeka isporuku" },
  { value: PROCUREMENT_AD_HOC_STATUS.RECEIVED, label: "Primljeno" },
  { value: PROCUREMENT_AD_HOC_STATUS.CANCELED, label: "Otkazano" },
];

/**
 * Stare vrednosti (kada su ad-hoc stavke koristile statuse reklamacija) mapiraju se u nove
 * radi prikaza istorijskih kešova / starih PDF-ova / starih klijenata.
 */
const LEGACY_AD_HOC_STATUS_MAP: Record<string, ProcurementAdHocStatus> = {
  reported_issue: PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER,
  awaiting_delivery: PROCUREMENT_AD_HOC_STATUS.ORDERED,
  resolved_received: PROCUREMENT_AD_HOC_STATUS.RECEIVED,
  canceled_refunded: PROCUREMENT_AD_HOC_STATUS.CANCELED,
};

export function normalizeProcurementAdHocStatus(status: string | null | undefined): ProcurementAdHocStatus {
  const v = String(status ?? "").trim();
  if ((PROCUREMENT_AD_HOC_STATUS_VALUES as string[]).includes(v)) {
    return v as ProcurementAdHocStatus;
  }
  return LEGACY_AD_HOC_STATUS_MAP[v] ?? PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER;
}

export function labelProcurementAdHocStatus(status: string | null | undefined): string {
  const normalized = normalizeProcurementAdHocStatus(status);
  return (
    PROCUREMENT_AD_HOC_STATUS_OPTIONS.find((o) => o.value === normalized)?.label ?? String(status ?? "")
  );
}

/** Aktivni / nerešeni: čekaju da se naruče ili stigne isporuka. */
export const PROCUREMENT_AD_HOC_ACTIVE_STATUSES: ProcurementAdHocStatus[] = [
  PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER,
  PROCUREMENT_AD_HOC_STATUS.ORDERED,
];

export function isProcurementAdHocActive(status: string | null | undefined): boolean {
  return PROCUREMENT_AD_HOC_ACTIVE_STATUSES.includes(normalizeProcurementAdHocStatus(status));
}

/** Vizuelna varijanta po statusu — koristi se na badge-u i u UI-ju liste. */
export function procurementAdHocBadgeVariant(
  status: string | null | undefined,
): "danger" | "warning" | "muted" | "success" {
  const normalized = normalizeProcurementAdHocStatus(status);
  switch (normalized) {
    case PROCUREMENT_AD_HOC_STATUS.NEEDS_ORDER:
      return "danger";
    case PROCUREMENT_AD_HOC_STATUS.ORDERED:
      return "warning";
    case PROCUREMENT_AD_HOC_STATUS.CANCELED:
      return "muted";
    case PROCUREMENT_AD_HOC_STATUS.RECEIVED:
    default:
      return "success";
  }
}
