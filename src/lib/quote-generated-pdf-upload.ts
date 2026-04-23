import { upsertSystemActivity } from "@/lib/activity-automation";
import { buildQuotePdfFileKey, deleteObjectFromR2, publicUrlWithCacheBust, uploadFileToR2 } from "@/lib/r2-storage";
import { supabase } from "@/lib/supabase";
import type { Quote } from "@/types";

/** Stabilan objekat u R2 po ponudi (prepis pri ponovnoj štampi). */
export function quoteGeneratedPdfStorageLeaf(quoteId: string): string {
  return `ponuda-autogenerisano-${quoteId}.pdf`;
}

export type QuotePdfUpsertResult = "created" | "updated";

export async function upsertQuoteGeneratedPdf(input: {
  quote: Quote;
  jobId: string;
  blob: Blob;
  uploadedBy: string;
}): Promise<QuotePdfUpsertResult> {
  const leaf = quoteGeneratedPdfStorageLeaf(input.quote.id);
  const storageKey = buildQuotePdfFileKey(input.jobId, leaf);
  const displayFilename = `Ponuda_${input.quote.quoteNumber.replace(/[^\w\u0400-\u04FF.-]/g, "_")}_v${input.quote.versionNumber}.pdf`;
  const file = new File([input.blob], displayFilename, { type: "application/pdf" });

  const { data: current, error: curErr } = await supabase
    .from("quotes")
    .select("file_storage_key")
    .eq("id", input.quote.id)
    .maybeSingle();
  if (curErr) throw curErr;

  const prevKey =
    current && typeof (current as { file_storage_key?: string }).file_storage_key === "string"
      ? (current as { file_storage_key: string }).file_storage_key.trim()
      : "";

  const hadQuotePdfBefore = Boolean(prevKey || (input.quote.fileUrl && input.quote.fileUrl.trim()));

  const basePublicUrl = await uploadFileToR2(storageKey, file);
  const storageUrl = publicUrlWithCacheBust(basePublicUrl);

  if (prevKey && prevKey !== storageKey) {
    try {
      await deleteObjectFromR2(prevKey);
    } catch {
      /* staro skladište možda već obrisano */
    }
  }

  const { error: upErr } = await supabase
    .from("quotes")
    .update({
      file_url: storageUrl,
      file_storage_key: storageKey,
    })
    .eq("id", input.quote.id);
  if (upErr) throw upErr;

  await upsertSystemActivity({
    jobId: input.jobId,
    description: `${hadQuotePdfBefore ? "Ažuriran" : "Sačuvan"} generisani PDF ponude ${input.quote.quoteNumber}`,
    systemKey: `quote-autopdf:${input.quote.id}`,
    authorId: input.uploadedBy,
  });

  return hadQuotePdfBefore ? "updated" : "created";
}
