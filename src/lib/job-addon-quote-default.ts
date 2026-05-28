import type { JobStatus } from "@/types";

/** Poslovi u kojima se nova ponuda podrazumeva kao dopuna (ne menja status posla pri prihvatu). */
export const JOB_STATUSES_DEFAULT_ADDON_QUOTE: ReadonlySet<JobStatus> = new Set([
  "installation_done_unpaid",
  "completed",
  "installation_problem",
  "installation_in_progress",
  "scheduled",
  "in_production",
  "partial_in_production",
  "waiting_material",
  "ready_for_work",
  "final_quote_accepted_pending_payment",
]);

export function defaultAddonQuoteForJobStatus(status: JobStatus | undefined): boolean {
  if (!status) return false;
  return JOB_STATUSES_DEFAULT_ADDON_QUOTE.has(status);
}
