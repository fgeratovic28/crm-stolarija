import { labelJobStatus } from "@/lib/activity-labels";
import type { Job, JobStatus } from "@/types";

/** Statusi posla koji ulaze u SLA praćenje (usklađeno sa zvončastim obaveštenjima). */
export const SLA_MONITORED_JOB_STATUSES: readonly JobStatus[] = [
  "new",
  "quote_sent",
  "final_quote_sent",
  "final_quote_accepted_pending_payment",
  "accepted",
  "measuring",
  "measurement_processing",
  "ready_for_work",
  "waiting_material",
  "partial_in_production",
  "in_production",
  "installation_done_unpaid",
] as const;

const SLA_STATUS_SET = new Set<JobStatus>(SLA_MONITORED_JOB_STATUSES);

export type StaleJobSlaRow = {
  jobId: string;
  jobNumber: string;
  customerName: string;
  status: JobStatus;
  statusLabel: string;
  daysInStatus: number;
  statusChangedAt: string;
  priority: "high" | "medium";
};

export function listStaleJobsForSla(jobs: Job[], thresholdDays: number): StaleJobSlaRow[] {
  if (!Number.isFinite(thresholdDays) || thresholdDays < 1) return [];

  const now = Date.now();
  const rows: StaleJobSlaRow[] = [];

  for (const j of jobs) {
    if (!SLA_STATUS_SET.has(j.status) || j.statusLocked === true) continue;

    const anchorStr = j.statusChangedAt ?? j.createdAt;
    const anchorMs = new Date(anchorStr).getTime();
    if (Number.isNaN(anchorMs)) continue;

    const days = Math.floor((now - anchorMs) / 86400000);
    if (days < thresholdDays) continue;

    rows.push({
      jobId: j.id,
      jobNumber: j.jobNumber,
      customerName: j.customer.fullName,
      status: j.status,
      statusLabel: labelJobStatus(j.status),
      daysInStatus: days,
      statusChangedAt: anchorStr,
      priority: days >= thresholdDays * 2 ? "high" : "medium",
    });
  }

  return rows.sort((a, b) => b.daysInStatus - a.daysInStatus || a.jobNumber.localeCompare(b.jobNumber));
}
