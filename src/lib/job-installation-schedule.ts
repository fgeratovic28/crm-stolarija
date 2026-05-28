import type { Job, WorkOrder } from "@/types";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import { formatScheduledDateTimeDisplay } from "@/lib/schedule-datetime-display";

/**
 * Jedinstven prikaz zakazanog datuma ugradnje: `jobs.scheduled_date` u aplikaciji,
 * inače najraniji datum sa radnog naloga tipa ugradnja (nije otkazan).
 */
export function getJobInstallationScheduleDisplay(job: Job, workOrders: WorkOrder[]): string | null {
  const fromJobAt = job.scheduledAt?.trim();
  if (fromJobAt) {
    return formatScheduledDateTimeDisplay(fromJobAt) ?? job.scheduledDate ?? fromJobAt;
  }

  const fromJob = job.scheduledDate?.trim();
  if (fromJob) return fromJob;

  const dates = workOrders
    .filter((w) => w.type === "installation" && w.status !== "canceled" && typeof w.date === "string")
    .map((w) => w.date.trim())
    .filter((d) => d.length > 0)
    .sort();

  if (dates.length === 0) return null;

  const raw = dates[0];
  return formatDateByAppLanguage(raw) || raw;
}
