/** Vrednosti kolone `procurement_complaints.status` (snake_case u bazi). */
export const PROCUREMENT_COMPLAINT_STATUS = {
  REPORTED_ISSUE: "reported_issue",
  AWAITING_DELIVERY: "awaiting_delivery",
  CANCELED_REFUNDED: "canceled_refunded",
  RESOLVED_RECEIVED: "resolved_received",
} as const;

export type ProcurementComplaintStatus =
  (typeof PROCUREMENT_COMPLAINT_STATUS)[keyof typeof PROCUREMENT_COMPLAINT_STATUS];

export const PROCUREMENT_COMPLAINT_STATUS_VALUES: ProcurementComplaintStatus[] = [
  PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE,
  PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY,
  PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED,
  PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED,
];

/** Opcije za padajući meni (redosled kao u specifikaciji). */
export const PROCUREMENT_COMPLAINT_STATUS_OPTIONS: { value: ProcurementComplaintStatus; label: string }[] = [
  { value: PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE, label: "Prijavljen problem" },
  { value: PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY, label: "U rešavanju / Čeka se dostava" },
  { value: PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED, label: "Otkazano / Refundirano" },
  { value: PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED, label: "Rešeno / Primljeno" },
];

/** Stari snake_case vrednosti (pre 2026-05-11) — mapiranje u nove radi prikaza istorijskih PDF-ova / kešova. */
const LEGACY_STATUS_MAP: Record<string, ProcurementComplaintStatus> = {
  urgent_pending: PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE,
  awaiting_supplier_response: PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY,
  refunded_credit_note: PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED,
  resolved_items_replaced: PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED,
};

export function normalizeProcurementComplaintStatus(status: string | null | undefined): ProcurementComplaintStatus {
  const v = String(status ?? "").trim();
  if ((PROCUREMENT_COMPLAINT_STATUS_VALUES as string[]).includes(v)) {
    return v as ProcurementComplaintStatus;
  }
  return LEGACY_STATUS_MAP[v] ?? PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE;
}

export function labelProcurementComplaintStatus(status: string): string {
  const normalized = normalizeProcurementComplaintStatus(status);
  return PROCUREMENT_COMPLAINT_STATUS_OPTIONS.find((o) => o.value === normalized)?.label ?? status;
}

/** Aktivne reklamacije koje treba pratiti na dashboardu (nisu terminalne). */
export const PROCUREMENT_COMPLAINT_ACTIVE_STATUSES: ProcurementComplaintStatus[] = [
  PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE,
  PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY,
];

export function isProcurementComplaintActive(status: string | null | undefined): boolean {
  return PROCUREMENT_COMPLAINT_ACTIVE_STATUSES.includes(normalizeProcurementComplaintStatus(status));
}

/** Vizuelna varijanta po statusu — koristi se na badge-u i u UI-ju liste. */
export function procurementComplaintBadgeVariant(
  status: string | null | undefined,
): "danger" | "warning" | "muted" | "success" {
  const normalized = normalizeProcurementComplaintStatus(status);
  switch (normalized) {
    case PROCUREMENT_COMPLAINT_STATUS.REPORTED_ISSUE:
      return "danger";
    case PROCUREMENT_COMPLAINT_STATUS.AWAITING_DELIVERY:
      return "warning";
    case PROCUREMENT_COMPLAINT_STATUS.CANCELED_REFUNDED:
      return "muted";
    case PROCUREMENT_COMPLAINT_STATUS.RESOLVED_RECEIVED:
    default:
      return "success";
  }
}
