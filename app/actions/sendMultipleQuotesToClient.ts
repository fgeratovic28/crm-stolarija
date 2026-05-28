"use server";

import {
  runSendMultipleQuotesEmailHandler,
  type SendMultipleQuotesPayload,
} from "../../lib/send-multiple-quotes-email-handler";

/**
 * Next.js server action: šalje više ponuda jednim mejlom (Resend), ažurira `quotes.status = sent` i status posla (`quote_sent` ili `final_quote_sent` ako je posao u obradi mera posle merenja).
 * Prosleđuje se JWT sesije iz klijenta kao za `/api/quotes/send-multiple`.
 */
export async function sendMultipleQuotesToClient(
  quoteIds: string[],
  jobId: string,
  message: string | undefined,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const token = accessToken?.trim();
  if (!token) {
    return { ok: false, error: "Niste prijavljeni." };
  }
  const payload: SendMultipleQuotesPayload = {
    jobId: jobId.trim(),
    quoteIds,
    message: message?.trim() || undefined,
  };
  const result = await runSendMultipleQuotesEmailHandler(payload, token);
  return result.body;
}
