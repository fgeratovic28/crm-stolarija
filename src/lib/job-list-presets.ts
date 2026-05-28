import type { JobStatus } from "@/types";

/** Statusi u fazi merenja / proizvodnje / ugradnje — usklađeno sa KPI na kontrolnoj tabli. */
export const JOB_LIST_PIPELINE_STATUSES = new Set<JobStatus>([
  "accepted",
  "measuring",
  "measurement_processing",
  "final_quote_sent",
  "final_quote_accepted_pending_payment",
  "ready_for_work",
  "waiting_material",
  "partial_in_production",
  "in_production",
  "installation_in_progress",
  "installation_done_unpaid",
]);

export const JOB_LIST_PRESETS = ["active", "pipeline", "complaints"] as const;
export type JobListPreset = (typeof JOB_LIST_PRESETS)[number];

export function isJobListPreset(value: string | null): value is JobListPreset {
  return value !== null && (JOB_LIST_PRESETS as readonly string[]).includes(value);
}

export function jobMatchesListPreset(preset: JobListPreset, status: JobStatus): boolean {
  if (preset === "active") {
    return status !== "completed" && status !== "canceled";
  }
  if (preset === "pipeline") {
    return JOB_LIST_PIPELINE_STATUSES.has(status);
  }
  return status === "complaint" || status === "service";
}
