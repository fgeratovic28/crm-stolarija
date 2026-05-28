import { formatDateByAppLanguage, formatDateTimeBySettings } from "@/lib/app-settings";
import {
  isoHasExplicitScheduleTime,
  normalizeWorkOrderDateYmd,
  parseScheduledTimeFromDescription,
} from "@/lib/work-order-schedule-calendar";
import { INSTALLATION_WORK_ORDER_TYPE } from "@/lib/job-status-lifecycle";
import type { WorkOrderType } from "@/types";

/** Datum + vreme samo ako je vreme stvarno uneto; inače samo datum. */
export function formatScheduledDateTimeDisplay(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const dateOnlyDisplay = () => {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return formatDateByAppLanguage(d) || raw;
    return formatDateByAppLanguage(raw) || raw;
  };

  if (!isoHasExplicitScheduleTime(raw)) return dateOnlyDisplay();

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return formatDateByAppLanguage(raw) || raw;
  return formatDateTimeBySettings(d) || null;
}

export function formatWorkOrderScheduleDisplay(input: {
  date?: string | null;
  description?: string | null;
  type?: WorkOrderType;
  jobScheduledAt?: string | null;
}): string | null {
  const dateRaw = input.date?.trim();
  if (!dateRaw) return null;

  if (isoHasExplicitScheduleTime(dateRaw)) {
    return formatScheduledDateTimeDisplay(dateRaw) ?? dateRaw;
  }

  const datePart = formatDateByAppLanguage(dateRaw) || normalizeWorkOrderDateYmd(dateRaw) || dateRaw;

  if (input.type === INSTALLATION_WORK_ORDER_TYPE && input.jobScheduledAt?.trim()) {
    const jobRaw = input.jobScheduledAt.trim();
    if (isoHasExplicitScheduleTime(jobRaw)) {
      return formatScheduledDateTimeDisplay(jobRaw) ?? datePart;
    }
  }

  const timeFromDesc = parseScheduledTimeFromDescription(input.description);
  if (timeFromDesc) return `${datePart} ${timeFromDesc}`;

  return datePart;
}

/** Prikaz termina na terenskoj kartici radnog naloga (uključuje `jobs.scheduled_date` za ugradnju). */
export function formatFieldTeamWorkOrderScheduleDisplay(wo: {
  date?: string | null;
  description?: string | null;
  type?: WorkOrderType;
  job?: { scheduledAt?: string | null; scheduledDate?: string | null } | null;
}): string {
  return (
    formatWorkOrderScheduleDisplay({
      date: wo.date,
      description: wo.description,
      type: wo.type,
      jobScheduledAt:
        wo.type === INSTALLATION_WORK_ORDER_TYPE
          ? wo.job?.scheduledAt ?? wo.job?.scheduledDate
          : undefined,
    }) ?? "—"
  );
}
