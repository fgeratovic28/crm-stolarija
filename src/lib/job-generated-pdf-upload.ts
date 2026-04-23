import { upsertSystemActivity } from "@/lib/activity-automation";
import { buildJobFilesObjectKey, deleteObjectFromR2, publicUrlWithCacheBust, uploadFileToR2 } from "@/lib/r2-storage";
import { supabase } from "@/lib/supabase";
import type { FileCategory } from "@/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type JobScopedPdfUpsertResult = "created" | "updated";

/**
 * Jedan stabilan PDF po poslu + ključu (npr. terenski izveštaj, radni nalog) u kartici Fajlovi.
 */
export async function upsertJobScopedGeneratedPdf(input: {
  jobId: string;
  /** Jedinstveno ime objekta u `files/jobs/{jobId}/…` (npr. terenski-izvestaj-{uuid}.pdf). */
  storageLeaf: string;
  blob: Blob;
  uploadedBy: string;
  displayFilename: string;
  category: FileCategory;
  activityDescription: string;
  systemKey: string;
}): Promise<JobScopedPdfUpsertResult> {
  const storageKey = buildJobFilesObjectKey(input.jobId, input.storageLeaf);
  const file = new File([input.blob], input.displayFilename, { type: "application/pdf" });
  const basePublicUrl = await uploadFileToR2(storageKey, file);
  const storageUrl = publicUrlWithCacheBust(basePublicUrl);

  const { data: rows, error: selErr } = await supabase
    .from("files")
    .select("id, storage_key")
    .eq("job_id", input.jobId)
    .eq("storage_key", storageKey);

  if (selErr) throw selErr;

  const existing = rows?.[0] as { id: string } | undefined;
  const sizeStr = formatSize(input.blob.size);
  const now = new Date().toISOString();

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from("files")
      .update({
        storage_key: storageKey,
        size: sizeStr,
        storage_url: storageUrl,
        uploaded_at: now,
        filename: input.displayFilename,
        category: input.category,
      })
      .eq("id", existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase.from("files").insert([
      {
        job_id: input.jobId,
        material_order_id: null,
        category: input.category,
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

  await upsertSystemActivity({
    jobId: input.jobId,
    description: input.activityDescription,
    systemKey: input.systemKey,
    authorId: input.uploadedBy,
  });

  return existing?.id ? "updated" : "created";
}
