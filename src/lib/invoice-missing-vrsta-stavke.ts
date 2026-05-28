/** Vrednosti kolone `procurement_ad_hoc_items.vrsta_stavke` (hitni triage + redovne stavke). */
export const INVOICE_MISSING_VRSTA_STAVKE = {
  GOTOV: "gotov_proizvod",
  SIROVINE: "sirovine_za_proizvodnju",
} as const;

export type InvoiceMissingVrstaStavke = (typeof INVOICE_MISSING_VRSTA_STAVKE)[keyof typeof INVOICE_MISSING_VRSTA_STAVKE];
