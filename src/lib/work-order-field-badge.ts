import { labelWorkOrderType } from "@/lib/activity-labels";
import type { WorkOrderType } from "@/types";

/** Kratak naziv za obojenu bedž kategoriju (5 ručnih tipova + mapiranje ostalog). */
export function workOrderFieldBadgeLabel(type: WorkOrderType): string {
  switch (type) {
    case "measurement":
    case "measurement_verification":
      return "Merenje";
    case "production":
      return "Proizvodnja";
    case "installation":
      return "Montaža";
    case "service":
      return "Servis";
    case "complaint":
      return "Reklamacija";
    default:
      return labelWorkOrderType(type);
  }
}

/** Klase za `Badge`: plava — merenje, narandžasta — proizvodnja, zelena — montaža, crvena — servis, ljubičasta — reklamacija. */
export function workOrderFieldBadgeClassName(type: WorkOrderType): string {
  switch (type) {
    case "measurement":
    case "measurement_verification":
      return "border-blue-500/40 bg-blue-600/15 text-blue-900 dark:text-blue-100";
    case "production":
      return "border-orange-500/40 bg-orange-500/15 text-orange-950 dark:text-orange-100";
    case "installation":
      return "border-emerald-500/40 bg-emerald-600/15 text-emerald-950 dark:text-emerald-100";
    case "service":
      return "border-red-500/45 bg-red-600/15 text-red-950 dark:text-red-100";
    case "complaint":
      return "border-violet-500/45 bg-violet-600/15 text-violet-950 dark:text-violet-100";
    default:
      return "border-border bg-muted/60 text-muted-foreground";
  }
}
