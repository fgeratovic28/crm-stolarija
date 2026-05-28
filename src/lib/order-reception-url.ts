/**
 * Apsolutni URL stranice prijema materijala (`/order-reception/:id`).
 * Postavi `VITE_PUBLIC_APP_URL` (npr. https://crm.example.com) da QR na PDF-u ne vodi na localhost.
 * Electron (hash router): koristi `/#/order-reception/...`.
 */
export function buildOrderReceptionAbsoluteUrl(materialOrderId: string): string {
  const id = materialOrderId.trim();
  if (!id) return "";

  const envBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  const isElectron = import.meta.env.VITE_ELECTRON_BUILD === "true";
  const viteBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const pathAfterOrigin = `${viteBase ? `${viteBase}/` : "/"}order-reception/${id}`.replace(/\/+/g, "/");

  if (isElectron) {
    if (envBase) {
      return `${envBase}/#${pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`}`;
    }
    if (typeof window === "undefined") return "";
    const { origin, pathname } = window.location;
    const pathBase = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return `${origin}${pathBase}#${pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`}`;
  }

  const origin = envBase || (typeof window !== "undefined" ? window.location.origin : "");
  if (!origin) return "";
  const path = pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`;
  return `${origin.replace(/\/$/, "")}${path}`;
}
