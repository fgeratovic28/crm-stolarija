import type { ImportedOrderItem } from "@/lib/procurement-excel-import";
import {
  procurementBarcodeValue,
  type ProcurementBarcodeScope,
} from "@/lib/material-order-procurement-pdf";
import type { MaterialOrderLine } from "@/types";

/** Jedna stavka u istom obliku kao za PDF barkod (deterministički string). */
export function materialOrderLineToImportedItemForBarcode(line: MaterialOrderLine): ImportedOrderItem | null {
  const m = line.procurementMeta;
  const desc = line.description?.trim() ?? "";
  const metaArticle = m?.article?.trim();
  /** Za prikaz artikla u PDF redu kad postoje nabavna polja. */
  const hasBarcodeSegmentFields = Boolean(
    m?.work_order?.trim() ||
      m?.position?.trim() ||
      m?.article_code?.trim() ||
      (m?.length_mm != null && Number.isFinite(m.length_mm)),
  );
  /** Tekst u PDF koloni ARTIKAL; segmentna polja ne menjaju barkod za ručne stavke (uvek M+cifre). */
  const article = hasBarcodeSegmentFields ? (metaArticle || desc) : (desc || metaArticle);
  if (!article) return null;
  const lineUnit = (line.unit ?? "kom").trim() || "kom";
  const metaUom = m?.uom?.trim();
  const uomForPdf = metaUom || (lineUnit !== "kom" ? lineUnit : undefined);
  return {
    ...(m?.work_order?.trim() ? { work_order: m.work_order.trim() } : {}),
    ...(m?.position?.trim() ? { position: m.position.trim() } : {}),
    ...(m?.article_code?.trim() ? { article_code: m.article_code.trim() } : {}),
    article,
    ...(m?.color?.trim() ? { color: m.color.trim() } : {}),
    ...(uomForPdf ? { uom: uomForPdf } : {}),
    length_mm: m?.length_mm != null && Number.isFinite(m.length_mm) ? m.length_mm : null,
    quantity: line.quantity,
    raw_row: {},
    /** Eksplicitno `false` samo za Excel uvoz; inače ručno → M-barkod u PDF/prijemu. */
    manual_line: m?.manual_line !== false,
  };
}

/**
 * Isti payload kao na štampanom PDF-u (Step 3). Za ručne stavke prosledi scope sa id narudžbine i indeksom reda.
 *
 * VAŽNO: ako linija ima `shortageSource` (linija u „Porudžbini po nedostatku"), barkod se računa
 * korišćenjem ORIGINALNE porudžbine i indeksa — magacin sken-uje isti barkod sa stare papirne
 * porudžbenice (bez ponovne štampe).
 */
export function procurementBarcodeValueForOrderLine(
  line: MaterialOrderLine,
  scope?: ProcurementBarcodeScope,
): string | null {
  const item = materialOrderLineToImportedItemForBarcode(line);
  if (!item) return null;
  const effectiveScope: ProcurementBarcodeScope | undefined = line.shortageSource
    ? {
        materialOrderId: line.shortageSource.parentOrderId,
        lineIndex: line.shortageSource.parentLineIndex,
      }
    : scope;
  return procurementBarcodeValue(item, effectiveScope);
}

/** PDF / barkod: sve stavke moraju imati bar artikal (često iz `description` ili Excel `procurementMeta`). */
export function procurementPdfRowsFromOrderLines(lines: MaterialOrderLine[]): ImportedOrderItem[] | null {
  if (!Array.isArray(lines) || !lines.length) return null;
  const out: ImportedOrderItem[] = [];
  for (const line of lines) {
    const item = materialOrderLineToImportedItemForBarcode(line);
    if (!item) return null;
    out.push(item);
  }
  return out;
}

export function orderLinesEligibleForProcurementPdf(lines: MaterialOrderLine[]): boolean {
  return procurementPdfRowsFromOrderLines(lines) !== null;
}
