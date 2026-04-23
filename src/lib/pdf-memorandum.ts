/**
 * Javni memorandum (public/memorandum.png) za štampu i PDF (html2canvas).
 */

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Apsolutni URL memoranduma (isti origin kao aplikacija ili VITE_PUBLIC_APP_URL). */
export function memorandumImageUrlForDocument(): string {
  try {
    if (typeof window !== "undefined" && window.location?.origin) {
      return `${window.location.origin}/memorandum.png`;
    }
  } catch {
    /* ignore */
  }
  const base = import.meta.env.VITE_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) return `${base}/memorandum.png`;
  return "/memorandum.png";
}

/** Zaglavlje sa memorandumom za dokumente koji koriste `PDF_DOCUMENT_STYLES`. */
export function pdfMemorandumHeaderHtml(): string {
  const src = escapeAttr(memorandumImageUrlForDocument());
  return `<div class="doc-memorandum"><img src="${src}" alt="" decoding="async" fetchpriority="high" /></div>`;
}
