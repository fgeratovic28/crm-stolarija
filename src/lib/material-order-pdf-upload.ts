import { upsertSystemActivity } from "@/lib/activity-automation";
import { buildMaterialOrderFileKey, publicUrlWithCacheBust, uploadFileToR2 } from "@/lib/r2-storage";
import { supabase } from "@/lib/supabase";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nullableJobId(jobId?: string | null): string | null {
  if (jobId === undefined || jobId === null) return null;
  const t = String(jobId).trim();
  return t.length > 0 ? t : null;
}

/** Javni URL ostaje isti posle prepisa u R2 — CDN/pregledač drže stari PDF. Uvek snimi novi query param. */
function storageUrlWithCacheBust(baseUrl: string): string {
  const v = Date.now();
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}v=${v}`;
}

/** Stabilan ključ u R2 — uvek isti objekat po narudžbini (prepis). */
export const MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF = "narudzbenica-autogenerisano.pdf";

/** Jedinstveno ime fajla po narudžbini (lista priloga); R2 ključ ostaje isti radi prepisa. */
export function buildMaterialOrderPdfDisplayName(orderId: string, jobNumber?: string | null): string {
  const id8 = orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const j = (jobNumber?.trim() || "bez-posla").replace(/[^\w\u0400-\u04FF-]/g, "_").slice(0, 28);
  return `Porudzbenica_${j}_${id8}.pdf`;
}

export type MaterialOrderPdfUpsertResult = "created" | "updated";

/**
 * Pronađi postojeći red generisanog PDF-a (isti `storage_key` ili isti „leaf” fajl u R2).
 */
function pickExistingGeneratedPdfRow(
  rows: { id: string; storage_key: string | null }[] | null | undefined,
  canonicalStorageKey: string,
): { id: string } | null {
  if (!rows?.length) return null;
  const exact = rows.find((r) => r.storage_key === canonicalStorageKey);
  if (exact) return { id: exact.id };
  const leaf = MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF;
  const byLeaf = rows.find(
    (r) =>
      typeof r.storage_key === "string" &&
      (r.storage_key === leaf || r.storage_key.endsWith(`/${leaf}`)),
  );
  return byLeaf ? { id: byLeaf.id } : null;
}

/**
 * Snima generisani PDF kao jedan prilog: prvi put insert, posle update istog reda + isti R2 ključ (prepis).
 * `displayFilename` je jedinstveno po narudžbini (vidljivo u CRM-u).
 */
export async function upsertMaterialOrderGeneratedPdf(input: {
  materialOrderId: string;
  jobId?: string | null;
  blob: Blob;
  uploadedBy: string;
  displayFilename: string;
}): Promise<MaterialOrderPdfUpsertResult> {
  const storageKey = buildMaterialOrderFileKey(input.materialOrderId, MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF);
  const file = new File([input.blob], input.displayFilename, { type: "application/pdf" });
  const basePublicUrl = await uploadFileToR2(storageKey, file);
  const storageUrl = publicUrlWithCacheBust(basePublicUrl);

  const { data: rows, error: selErr } = await supabase
    .from("files")
    .select("id, storage_key")
    .eq("material_order_id", input.materialOrderId);

  if (selErr) throw selErr;

  const existing = pickExistingGeneratedPdfRow(rows as { id: string; storage_key: string | null }[], storageKey);

  const sizeStr = formatSize(input.blob.size);
  const now = new Date().toISOString();
  const jobIdForDb = nullableJobId(input.jobId);

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from("files")
      .update({
        storage_key: storageKey,
        size: sizeStr,
        storage_url: storageUrl,
        uploaded_at: now,
        filename: input.displayFilename,
        ...(jobIdForDb ? { job_id: jobIdForDb } : {}),
      })
      .eq("id", existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase.from("files").insert([
      {
        job_id: jobIdForDb,
        material_order_id: input.materialOrderId,
        category: "supplier",
        filename: input.displayFilename,
        size: sizeStr,
        uploaded_by: input.uploadedBy,
        uploaded_at: now,
        storage_key: storageKey,
        storage_url: storageUrl,
      },
    ]);
    if (insErr) throw insErr;
  }

  if (jobIdForDb) {
    const action = existing?.id ? "Ažuriran" : "Sačuvan";
    await upsertSystemActivity({
      jobId: jobIdForDb,
      description: `${action} PDF porudžbenice u prilozima: ${input.displayFilename}`,
      systemKey: `material-order-autopdf:${input.materialOrderId}`,
      authorId: input.uploadedBy,
    });
  }

  return existing?.id ? "updated" : "created";
}
