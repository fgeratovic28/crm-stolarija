/** Dozvoljena veličina slike kada se povlači preko isti-origin proxy-ja (server / Vite middleware). */
export const R2_IMAGE_PROXY_MAX_BYTES = 5 * 1024 * 1024;

/** Javni R2 URL (bez završnog /) — čitaj iz VITE_R2_PUBLIC_BASE_URL ili R2_PUBLIC_BASE_URL. */
export function pickR2PublicBaseUrl(env: Record<string, string | undefined>): string | null {
  const raw = env.VITE_R2_PUBLIC_BASE_URL ?? env.R2_PUBLIC_BASE_URL ?? "";
  const s = raw.trim().replace(/\/+$/, "");
  return s.length > 0 ? s : null;
}

export function isProxyableR2ImageUrl(targetUrl: string, r2PublicBase: string | undefined | null): boolean {
  const t = targetUrl.trim();
  if (!t || t.includes("..")) return false;

  // 1) Ako imamo eksplicitni javni base URL (custom domena ili r2.dev domen),
  //    onda strogo proveravamo da URL leži ispod tog base-a.
  if (r2PublicBase) {
    const base = String(r2PublicBase).trim().replace(/\/+$/, "");
    return t.startsWith(`${base}/`) || t === base;
  }

  // 2) Fallback: dozvoli tipične R2 hostove bez env-a.
  //    (Ovo je bitno jer UI `<img src>` može da radi i bez CORS-a, ali `fetch()` za PDF može da padne.)
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();

    const looksLikeR2Dev = host.endsWith(".r2.dev") || host.endsWith("r2.dev");
    const looksLikeCloudflareR2 = host.endsWith(".r2.cloudflarestorage.com") || host.endsWith("r2.cloudflarestorage.com");
    if (looksLikeR2Dev || looksLikeCloudflareR2) return true;

    // Bez base URL-a ne može se sigurnije zaključiti za custom domenu, pa blokiramo.
    return false;
  } catch {
    return false;
  }
}

export async function fetchImageBytesFromUpstream(
  url: string,
  maxBytes: number = R2_IMAGE_PROXY_MAX_BYTES,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  if (!res.ok) return null;
  const cl = res.headers.get("content-length");
  if (cl != null && Number(cl) > maxBytes) return null;
  const ab = await res.arrayBuffer();
  if (ab.byteLength > maxBytes) return null;
  let ct = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ct || ct === "application/octet-stream" || ct === "binary/octet-stream") {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".png")) ct = "image/png";
    else if (pathname.endsWith(".webp")) ct = "image/webp";
    else ct = "image/jpeg";
  }
  return { bytes: new Uint8Array(ab), contentType: ct };
}
