import type { Quote, QuoteFileAttachment } from "@/types";
import { normalizeQuoteFileAttachments } from "../../lib/normalize-quote-file-attachments";

export type { QuoteFileAttachment };

/** Mapira `quotes.file_attachments` i fallback na starije kolone ako je niz prazan. */
export function normalizeDbQuoteAttachments(
  raw: unknown,
  legacyUrl?: string | null,
  legacyStorageKey?: string | null,
): QuoteFileAttachment[] {
  return normalizeQuoteFileAttachments(raw, legacyUrl, legacyStorageKey);
}

/** Da li ponuda ima makar jedan otpremljeni prilog (za selekciju za mejl). */
export function quoteHasAttachments(q: Pick<Quote, "fileAttachments" | "fileUrl">): boolean {
  if (Array.isArray(q.fileAttachments) && q.fileAttachments.length > 0) return true;
  return Boolean(q.fileUrl?.trim());
}
