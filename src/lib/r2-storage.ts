import { FunctionsFetchError } from "@supabase/functions-js";
import { supabase } from "@/lib/supabase";

/** Ime Edge funkcije; R2 bucket i kredencijali su samo u Supabase secrets (bez hardkodovanja). */
const EDGE_FUNCTION = "r2-storage";

function getPublicBaseUrl(): string {
  const raw = import.meta.env.VITE_R2_PUBLIC_BASE_URL;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      "Nedostaje VITE_R2_PUBLIC_BASE_URL (javni URL R2 bucketa ili custom domene, bez završnog /).",
    );
  }
  return raw.replace(/\/$/, "");
}

/**
 * Javni URL objekta u R2 (custom domena ili r2.dev), u skladu sa presigned upload-om.
 */
export function publicUrlForStorageKey(key: string): string {
  const base = getPublicBaseUrl();
  const segments = key.split("/").filter(Boolean).map(encodeURIComponent);
  return `${base}/${segments.join("/")}`;
}

/** Isti javni URL posle prepisa u R2 — dodaj cache-bust da pregledač ne drži stari fajl. */
export function publicUrlWithCacheBust(baseUrl: string): string {
  const v = Date.now();
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}v=${v}`;
}

type PresignPutResponse = { key: string; uploadUrl: string };

function serializeErrorContext(context: unknown): string | null {
  if (context == null) return null;
  if (typeof context === "string") return context;
  if (context instanceof Error) return context.message;
  if (typeof context === "object" && context !== null && "message" in context) {
    const m = (context as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  try {
    const s = JSON.stringify(context);
    if (s !== "{}") return s;
  } catch {
    /* ignore */
  }
  return null;
}

function formatEdgeFunctionError(err: unknown, fallback: string): string {
  if (err instanceof FunctionsFetchError) {
    const inner = serializeErrorContext(err.context);
    const detail = inner ? ` (${inner})` : "";
    const hint =
      "Fetch do Edge funkcije nije uspeo. Uzroci: funkcija nije deploy-ovana na ovaj projekat, pogrešan VITE_SUPABASE_URL, blokada mreže/adblock, ili Service Worker (probaj unregister u Application). U DevTools → Network traži …/functions/v1/r2-storage.";
    return `${err.message}${detail}. ${hint}`;
  }

  const e = err as { message?: string; context?: unknown; status?: number };
  const parts = [e?.message, e?.status != null ? `HTTP ${e.status}` : null, serializeErrorContext(e?.context)];
  const joined = parts.filter(Boolean).join(" — ");
  if (!joined) return fallback;
  if (/failed to send|network|fetch/i.test(joined)) {
    return `${joined}. Proveri: Edge Function „${EDGE_FUNCTION}” na istom Supabase projektu kao u .env, Secrets (R2_*), Network → …/functions/v1/${EDGE_FUNCTION}.`;
  }
  return joined;
}

async function presignPut(key: string, contentType: string): Promise<PresignPutResponse> {
  const { data, error } = await supabase.functions.invoke<PresignPutResponse>(EDGE_FUNCTION, {
    body: {
      op: "presign-put",
      key,
      contentType: contentType || "application/octet-stream",
    },
  });
  if (error) {
    throw new Error(formatEdgeFunctionError(error, "Greška pri pripremi otpremanja (presign)"));
  }
  if (!data?.uploadUrl || !data?.key) {
    throw new Error("Neočekivan odgovor skladišnog servisa");
  }
  return data;
}

/**
 * Otprema fajl u R2 preko presigned PUT (tajni ključevi ostaju na Edge Function).
 */
export async function uploadFileToR2(key: string, file: File): Promise<string> {
  const contentType = file.type?.trim() || "application/octet-stream";
  const { uploadUrl } = await presignPut(key, contentType);

  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|load failed|networkerror/i.test(msg)) {
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "tvoj-domen";
      throw new Error(
        `Upload ka R2 je blokiran (${msg}). U Cloudflare → R2 → bucket → CORS dodaj Allowed Origin: ${origin}, metode PUT (i GET), zaglavlja Content-Type.`,
      );
    }
    throw e;
  }

  if (!res.ok) {
    throw new Error(`Otpremanje nije uspelo (${res.status})`);
  }
  return publicUrlForStorageKey(key);
}

/**
 * Briše objekat iz R2 (S3 DeleteObject).
 */
export async function deleteObjectFromR2(key: string): Promise<void> {
  const { error } = await supabase.functions.invoke(EDGE_FUNCTION, {
    body: { op: "delete", key },
  });
  if (error) {
    throw new Error(formatEdgeFunctionError(error, "Greška pri brisanju iz skladišta"));
  }
}

export function buildJobFilesObjectKey(jobId: string | undefined, uniqueName: string): string {
  return jobId ? `files/jobs/${jobId}/${uniqueName}` : `files/misc/${uniqueName}`;
}

/** Prilozi uz narudžbinu materijala (više fajlova po narudžbini). */
export function buildMaterialOrderFileKey(materialOrderId: string, uniqueName: string): string {
  return `files/material-orders/${materialOrderId}/${uniqueName}`;
}

export function buildQuotePdfFileKey(jobId: string, uniqueName: string): string {
  return `files/quotes/${jobId}/${uniqueName}`;
}

/**
 * Terenske fotografije iz modula Fajlovi (kategorija field_photos).
 * Javni URL ide u `files.storage_url`, ključ u `files.storage_key` (bivši Supabase bucket `field-photos`).
 */
export function buildFieldPhotosFileKey(jobId: string | undefined, uniqueName: string): string {
  return jobId ? `field-photos/jobs/${jobId}/${uniqueName}` : `field-photos/misc/${uniqueName}`;
}

/** Slike uz terenski izveštaj → `field_reports.images` (niz javnih URL-ova). */
export function buildFieldReportPhotoKey(uniqueName: string): string {
  return `field-photos/field-reports/${uniqueName}`;
}

/** Dokumentacija vozila → kolone `vehicles.*_image_url` / `additional_image_urls`. */
export function buildVehiclePhotoKey(uniqueName: string): string {
  return `field-photos/vehicles/${uniqueName}`;
}

/** Slike montaže za radni nalog → tabela `montaze` (image_url / storage_key). */
export function buildWorkOrderMontazaImageKey(workOrderId: string, uniqueName: string): string {
  return `field-photos/work-orders/${workOrderId}/${uniqueName}`;
}
