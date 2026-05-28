import type { WorkOrder } from "@/types";

/**
 * Mapiranje šeme u bazi (`work_order_status`) na operativne nazive (UI / uputstvo).
 * U bazi: `pending` | `in_progress` | `completed` | `canceled`.
 */
export const WORK_ORDER_DB_STATUS_HR: Record<WorkOrder["status"], string> = {
  pending: "Na čekanju",
  in_progress: "U toku",
  completed: "Uspešno",
  canceled: "Otkazano",
};
