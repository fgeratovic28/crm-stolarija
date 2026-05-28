const STORAGE_KEY = "crm-procurement-supplier-email-signature";

export const DEFAULT_PROCUREMENT_SUPPLIER_EMAIL_SIGNATURE = `Srdačan pozdrav,
Termo Plast d.o.o.`;

export function loadProcurementSupplierEmailSignature(): string {
  if (typeof window === "undefined") return DEFAULT_PROCUREMENT_SUPPLIER_EMAIL_SIGNATURE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw != null && raw.trim()) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_PROCUREMENT_SUPPLIER_EMAIL_SIGNATURE;
}

export function saveProcurementSupplierEmailSignature(signature: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, signature);
  } catch {
    /* ignore */
  }
}
