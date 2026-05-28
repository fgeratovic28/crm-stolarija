import type { WorkOrderType } from "@/types";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";

/** Pet kanonskih tipova u filterima (lista radnih naloga i sl.). */
export const WORK_ORDER_TYPE_FILTER_OPTIONS: readonly {
  value: WorkOrderType;
  label: string;
}[] = [
  { value: "measurement", label: "Merenje" },
  { value: PRODUCTION_WORK_ORDER_TYPE, label: "Proizvodnja" },
  { value: INSTALLATION_WORK_ORDER_TYPE, label: "Ugradnja" },
  { value: "complaint", label: "Reklamacija" },
  { value: "service", label: "Servis" },
];

const TYPE_FILTER_DB_TYPES: Record<
  (typeof WORK_ORDER_TYPE_FILTER_OPTIONS)[number]["value"],
  readonly WorkOrderType[]
> = {
  measurement: MEASUREMENT_WORK_ORDER_TYPES,
  production: [PRODUCTION_WORK_ORDER_TYPE],
  installation: [INSTALLATION_WORK_ORDER_TYPE],
  complaint: ["complaint"],
  service: ["service", ...NON_BLOCKING_SCHEDULE_WORK_ORDER_TYPES],
};

export function workOrderTypeFilterOptions(): { value: WorkOrderType; label: string }[] {
  return [...WORK_ORDER_TYPE_FILTER_OPTIONS];
}

/** Da li RN tip odgovara izabranom filteru (uključuje povezane DB tipove, npr. provera mera → Merenje). */
export function workOrderMatchesTypeFilter(filterValue: string, workOrderType: WorkOrderType): boolean {
  if (filterValue === "all") return true;
  const allowed = TYPE_FILTER_DB_TYPES[filterValue as keyof typeof TYPE_FILTER_DB_TYPES];
  if (!allowed) return workOrderType === filterValue;
  return allowed.includes(workOrderType);
}
