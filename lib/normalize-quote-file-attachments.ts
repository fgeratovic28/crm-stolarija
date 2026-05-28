/** Deljen parser za JSON `quotes.file_attachments` — koristi i Vercel handler i SPA. */

export interface NormalizedQuoteAttachment {
  url: string;
  storageKey?: string;
  filename?: string;
}

export function normalizeQuoteFileAttachments(
  raw: unknown,
  legacyUrl?: string | null,
  legacyStorageKey?: string | null,
): NormalizedQuoteAttachment[] {
  const out: NormalizedQuoteAttachment[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      const url = typeof rec.url === "string" ? rec.url.trim() : "";
      if (!url) continue;
      const skRaw = rec.storage_key ?? rec.storageKey;
      const storageKey =
        typeof skRaw === "string" && skRaw.trim() ? skRaw.trim() : undefined;
      const fnRaw = rec.filename;
      const fname =
        typeof fnRaw === "string" && fnRaw.trim() ? fnRaw.trim().slice(0, 240) : undefined;
      out.push({ url, storageKey, filename: fname });
    }
  }

  if (out.length === 0) {
    const u = legacyUrl?.trim();
    if (u) {
      const k = legacyStorageKey?.trim();
      out.push({ url: u, storageKey: k || undefined });
    }
  }

  return out;
}
