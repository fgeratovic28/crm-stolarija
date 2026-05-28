/**
 * Apsolutni URL public redirect stranice za porudžbinu (`/r/order/:orderId?kind=adhoc|complaint`).
 * QR sa PDF-a vodi ovde:
 *  - autentifikovan korisnik se prebacuje na `/order-reception/<order_id>` (skener prijema),
 *  - neautentifikovan posetilac (samo ad-hoc) se preusmerava na storage URL priloga (faktura/specifikacija).
 *
 * Postavi `VITE_PUBLIC_APP_URL` (npr. https://crm.example.com) da QR na PDF-u ne vodi na localhost.
 * Electron (hash router): koristi `/#/r/order/...`.
 */
export function buildProcurementOrderPublicRedirectUrl(
  orderId: string,
  kind: "adhoc" | "complaint",
): string {
  const id = orderId.trim();
  if (!id) return "";

  const envBase = import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || "";
  const isElectron = import.meta.env.VITE_ELECTRON_BUILD === "true";
  const viteBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const query = `?kind=${encodeURIComponent(kind)}`;
  const pathAfterOrigin = `${viteBase ? `${viteBase}/` : "/"}r/order/${id}`.replace(/\/+/g, "/");

  if (isElectron) {
    if (envBase) {
      return `${envBase}/#${pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`}${query}`;
    }
    if (typeof window === "undefined") return "";
    const { origin, pathname } = window.location;
    const pathBase = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return `${origin}${pathBase}#${pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`}${query}`;
  }

  const origin = envBase || (typeof window !== "undefined" ? window.location.origin : "");
  if (!origin) return "";
  const path = pathAfterOrigin.startsWith("/") ? pathAfterOrigin : `/${pathAfterOrigin}`;
  return `${origin.replace(/\/$/, "")}${path}${query}`;
}
