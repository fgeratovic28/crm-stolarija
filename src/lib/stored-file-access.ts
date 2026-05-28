import { supabase } from "@/lib/supabase";
import { publicUrlWithCacheBust } from "@/lib/r2-storage";

/** Otvara fajl u novom tabu (R2 javni URL ili legacy Supabase storage). */
export async function openStoredFileById(
  fileId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const fileRow = await supabase
    .from("files")
    .select("storage_key, storage_url")
    .eq("id", fileId)
    .single();

  if (fileRow.error || !fileRow.data) {
    return { ok: false, message: "Fajl nije pronađen." };
  }

  const { storage_key, storage_url } = fileRow.data as {
    storage_key?: string | null;
    storage_url?: string | null;
  };

  if (storage_url) {
    window.open(publicUrlWithCacheBust(storage_url), "_blank", "noopener,noreferrer");
    return { ok: true };
  }

  if (storage_key) {
    const { data, error: dlErr } = await supabase.storage.from("files").download(storage_key);
    if (dlErr || !data) {
      return { ok: false, message: dlErr?.message ?? "Preuzimanje nije uspelo." };
    }
    const blobUrl = URL.createObjectURL(data);
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return { ok: true };
  }

  return { ok: false, message: "Nema dostupnog URL-a za fajl." };
}
