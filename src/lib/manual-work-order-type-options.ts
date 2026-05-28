import type { WorkOrderType } from "@/types";

/**
 * Ručno dodavanje radnog naloga: samo ovih pet tipova — mapiranje na `work_orders.type`.
 */
export const MANUAL_WORK_ORDER_TYPE_OPTIONS: readonly { value: WorkOrderType; label: string }[] = [
  { value: "measurement", label: "Merenje" },
  { value: "production", label: "Proizvodnja" },
  { value: "installation", label: "Montaža" },
  { value: "service", label: "Servis" },
  { value: "complaint", label: "Reklamacija" },
];

export const MANUAL_WORK_ORDER_TYPE_VALUES = new Set<WorkOrderType>(
  MANUAL_WORK_ORDER_TYPE_OPTIONS.map((o) => o.value),
);
