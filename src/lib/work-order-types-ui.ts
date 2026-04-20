import type { WorkOrderType } from "@/types";
import { labelWorkOrderType } from "@/lib/activity-labels";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";

/**
 * Tipovi RN u redosledu koji prati operativni tok (merenje → proizvodnja → ugradnja → ostalo).
 * Ne menja pravila statusa posla — samo UI / filteri.
 */
export const WORK_ORDER_TYPES_DISPLAY_ORDER: readonly WorkOrderType[] = [
  ...MEASUREMENT_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
  INSTALLATION_WORK_ORDER_TYPE,
  "complaint",
  "service",
  ...NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES,
];

/** Grupe za padajuću listu tipa naloga (povezano sa fazama statusa posla u smislu opisa, ne logike). */
export const WORK_ORDER_TYPE_SELECT_GROUPS: readonly {
  readonly heading: string;
  /** Tooltip — veza sa statusom posla u reči, bez promene automatskih pravila. */
  readonly caption: string;
  readonly types: readonly WorkOrderType[];
}[] = [
  {
    heading: "Merenje",
    caption: "Faza posla: „Merenje“ (RN u toku / završen merenje).",
    types: MEASUREMENT_WORK_ORDER_TYPES,
  },
  {
    heading: "Proizvodnja",
    caption: "Faza posla: „U proizvodnji“.",
    types: [PRODUCTION_WORK_ORDER_TYPE],
  },
  {
    heading: "Ugradnja",
    caption: "Faza posla: „Čeka ugradnju“ / „Ugradnja u toku“.",
    types: [INSTALLATION_WORK_ORDER_TYPE],
  },
  {
    heading: "Servis i dodatni nalozi",
    caption: "Reklamacija, servis, posete — van glavnog automatskog toka statusa.",
    types: ["complaint", "service", ...NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES],
  },
];

export function workOrderTypeFilterOptions(): { value: WorkOrderType; label: string }[] {
  return WORK_ORDER_TYPES_DISPLAY_ORDER.map((value) => ({
    value,
    label: labelWorkOrderType(value),
  }));
}
