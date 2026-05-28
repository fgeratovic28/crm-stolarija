import { normalizeProcurementBarcodePlainText } from "@/lib/material-order-procurement-pdf";

/** Fiksni Code128: potvrdi unos prijema stavke u modalu magacina. */
export const ITEM_RECEPTION_CONFIRM_BARCODE = "P000000001";

/** Fiksni Code128: otkaži / zatvori modal bez čuvanja. */
export const ITEM_RECEPTION_CANCEL_BARCODE = "O000000001";

/** Fiksni Code128: završi prijem cele porudžbine (stranica prijema). */
export const ORDER_RECEPTION_FINALIZE_BARCODE = "F000000001";

export type ItemReceptionModalScanAction = "confirm" | "cancel";

export type ReceptionActionBarcodeRow = {
  label: string;
  hint: string;
  code: string;
};

export const RECEPTION_ACTION_BARCODE_ROWS: ReceptionActionBarcodeRow[] = [
  {
    label: "Potvrdi stavku",
    hint: "Modal prijema — sacuva kolicine",
    code: ITEM_RECEPTION_CONFIRM_BARCODE,
  },
  {
    label: "Otkazi stavku",
    hint: "Modal prijema — zatvori bez cuvanja",
    code: ITEM_RECEPTION_CANCEL_BARCODE,
  },
  {
    label: "Zavrsi prijem porudzbine",
    hint: "Stranica prijema — kad su sve stavke unete",
    code: ORDER_RECEPTION_FINALIZE_BARCODE,
  },
];

export function normalizeItemReceptionActionBarcode(raw: string): string {
  return normalizeProcurementBarcodePlainText(raw.trim());
}

export function matchItemReceptionActionBarcode(raw: string): ItemReceptionModalScanAction | null {
  const norm = normalizeItemReceptionActionBarcode(raw);
  if (norm === ITEM_RECEPTION_CONFIRM_BARCODE) return "confirm";
  if (norm === ITEM_RECEPTION_CANCEL_BARCODE) return "cancel";
  return null;
}

export function isOrderReceptionFinalizeBarcode(raw: string): boolean {
  return normalizeItemReceptionActionBarcode(raw) === ORDER_RECEPTION_FINALIZE_BARCODE;
}

export function isItemReceptionActionBarcode(raw: string): boolean {
  return matchItemReceptionActionBarcode(raw) !== null;
}

export function isReceptionSystemActionBarcode(raw: string): boolean {
  return isItemReceptionActionBarcode(raw) || isOrderReceptionFinalizeBarcode(raw);
}
