import type { WorkOrder } from "@/types";

/** Boje statusa radnog naloga (bedž na kartici terena, lista, mapa). */
export function workOrderStatusBadgeClassName(status: WorkOrder["status"]): string {
  switch (status) {
    case "pending":
      return "border-amber-500/50 bg-amber-500/20 text-amber-950 dark:text-amber-100 font-semibold shadow-none";
    case "in_progress":
      return "border-blue-500/45 bg-blue-600/15 text-blue-900 dark:text-blue-100 font-semibold shadow-none";
    case "completed":
      return "border-emerald-500/40 bg-emerald-600/15 text-emerald-800 dark:text-emerald-400 font-semibold shadow-none";
    case "canceled":
      return "border-destructive/40 bg-destructive/15 text-destructive font-semibold shadow-none";
    default:
      return "border-border bg-muted/60 text-muted-foreground font-semibold shadow-none";
  }
}

export function workOrderStatusBadgeVariant(
  status: WorkOrder["status"],
): "success" | "warning" | "info" | "danger" | "muted" {
  switch (status) {
    case "completed":
      return "success";
    case "in_progress":
      return "info";
    case "pending":
      return "warning";
    case "canceled":
      return "danger";
    default:
      return "muted";
  }
}
