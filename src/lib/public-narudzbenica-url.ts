/**
 * Javni URL iste porudžbenice (za QR) — radi u browseru i u Electron (hash router).
 *
 * U bazi je `public_share_token`; pun URL je uvek `{javni domen}/narudzbenica/{token}`.
 * Postavi `VITE_PUBLIC_APP_URL` (npr. https://crm.tvojdomen.rs) da QR na štampi/PDF-u
 * ne pokazuje na localhost kada generišeš dokument lokalno.
 */
export function buildPublicNarudzbenicaUrl(publicShareToken: string): string {
  if (!publicShareToken) return "";

  const envBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  const isElectron = import.meta.env.VITE_ELECTRON_BUILD === "true";

  if (isElectron) {
    if (envBase) {
      return `${envBase}/#/narudzbenica/${publicShareToken}`;
    }
    if (typeof window === "undefined") return "";
    const { origin, pathname } = window.location;
    const pathBase = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return `${origin}${pathBase}#/narudzbenica/${publicShareToken}`;
  }

  const base =
    envBase || (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) return "";
  return `${base}/narudzbenica/${publicShareToken}`;
}
