import type { JobStatus, Quote } from "@/types";

const FINAL_QUOTE_JOB_STATUSES: JobStatus[] = [
  "final_quote_sent",
  "final_quote_accepted_pending_payment",
];

/**
 * Da li pri prihvatanju treba uneti konačan iznos (finalna / dopunska ponuda).
 * Početna ponuda pre merenja prihvata se bez iznosa; iznos ide na posao tek posle finalne.
 */
export function quoteAcceptanceRequiresConfirmedPrice(
  jobStatus: JobStatus | undefined,
  quote: Pick<Quote, "isFinalOffer" | "isAddonWork" | "versionNumber">,
  opts?: { isChildJob?: boolean },
): boolean {
  if (quote.isAddonWork) return true;
  if (opts?.isChildJob) return true;
  if (quote.isFinalOffer) return true;
  if ((quote.versionNumber ?? 1) > 1) return true;
  if (jobStatus && FINAL_QUOTE_JOB_STATUSES.includes(jobStatus)) return true;
  return false;
}
