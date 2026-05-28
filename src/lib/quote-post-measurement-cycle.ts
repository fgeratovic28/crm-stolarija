/** Polja dovoljna za isti filter kao SQL `recompute_job_status` (post-merni ciklus). */
export type QuotePostMeasurementCycleFields = {
  isFinalOffer?: boolean;
  versionNumber?: number;
  createdAt?: string;
};

/**
 * Da li ponuda ulazi u post-merni / finalni tok (prihvatanje sa iznosom, status posla final_quote_*).
 * Usklađeno sa `quote_in_post_measurement_cycle` u bazi.
 */
export function quoteInPostMeasurementCycle(
  quote: QuotePostMeasurementCycleFields,
  measurementFinishedAtMs: number,
): boolean {
  if (quote.isFinalOffer === true) return true;
  const versionNumber = quote.versionNumber ?? 1;
  const createdMs = quote.createdAt ? Date.parse(quote.createdAt) : 0;
  if (measurementFinishedAtMs <= 0) return versionNumber > 1;
  return Number.isFinite(createdMs) && createdMs >= measurementFinishedAtMs;
}
