/**
 * Parsiranje UBL / SEF e-računa (XML → stavke).
 * Koristi fast-xml-parser (stabilno za jedan element vs niz); DOM parser kao rezerva.
 */
import { XMLParser } from "fast-xml-parser";
import { parseUblInvoiceLikeXml, type ParsedUblDocument, type ParsedUblLine } from "@/lib/sef-ubl-xml";

function pickText(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string" || typeof val === "number") return String(val).trim();
  if (typeof val === "object" && val !== null && "#text" in val) {
    return String((val as { "#text": unknown })["#text"]).trim();
  }
  return "";
}

function parseMoney(raw: string): number {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Pronalazi Invoice ili CreditNote u dubokom stablu (SEF omotači, Envelope, itd.). */
function findInvoiceRoot(obj: unknown, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object" || depth > 40) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.Invoice === "object" && o.Invoice !== null) return o.Invoice as Record<string, unknown>;
  if (typeof o.CreditNote === "object" && o.CreditNote !== null) return o.CreditNote as Record<string, unknown>;
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") {
      const hit = findInvoiceRoot(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function extractLinesFromInvoice(inv: Record<string, unknown>): ParsedUblLine[] {
  const out: ParsedUblLine[] = [];
  const lineKeys = ["InvoiceLine", "CreditNoteLine"];
  for (const key of lineKeys) {
    const raw = inv[key];
    for (const line of asArray(raw as ParsedUblLine[] | ParsedUblLine | undefined)) {
      if (!line || typeof line !== "object") continue;
      const row = line as Record<string, unknown>;
      const item = row.Item;
      const itemObj = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      const nameRaw = itemObj?.Name ?? itemObj?.Description;
      const desc = pickText(nameRaw) || "—";

      const qtyRaw =
        row.InvoicedQuantity ??
        row.CreditedQuantity ??
        row.Quantity ??
        (row as { DeliveredQuantity?: unknown }).DeliveredQuantity;
      const qty = parseMoney(pickText(qtyRaw));

      const lineNetRaw = row.LineExtensionAmount ?? row.TaxExclusiveAmount;
      const lineNet = parseMoney(pickText(lineNetRaw));

      const priceBlock = row.Price;
      let unitFromPrice: number | null = null;
      if (priceBlock && typeof priceBlock === "object") {
        const pb = priceBlock as Record<string, unknown>;
        const priceAmt = pb.PriceAmount ?? pb.BaseAmount;
        const baseQty = pb.BaseQuantity;
        const pa = parseMoney(pickText(priceAmt));
        const bq = parseMoney(pickText(baseQty));
        if (bq > 0 && pa > 0) unitFromPrice = Math.round((pa / bq) * 10000) / 10000;
        else if (pa > 0 && qty > 0) unitFromPrice = Math.round((pa / qty) * 10000) / 10000;
      }

      const line: ParsedUblLine = {
        description: desc,
        quantity: qty > 0 ? qty : 0,
        lineNet: lineNet > 0 || desc !== "—" ? lineNet : 0,
      };
      if (unitFromPrice != null && unitFromPrice > 0) line.unitPriceNet = unitFromPrice;
      out.push(line);
    }
  }
  return out;
}

function extractTaxExclusive(inv: Record<string, unknown>): number | null {
  const lmt = inv.LegalMonetaryTotal;
  if (!lmt || typeof lmt !== "object") return null;
  const t = lmt as Record<string, unknown>;
  const raw =
    t.TaxExclusiveAmount ?? t.TaxInclusiveAmount ?? t.LineExtensionAmount ?? t.PayableAmount;
  const v = parseMoney(pickText(raw));
  return pickText(raw) ? v : null;
}

function extractDocumentId(inv: Record<string, unknown>): string | undefined {
  const raw = inv.ID ?? inv.Uuid;
  const t = pickText(raw);
  return t.length > 0 && t.length < 120 ? t : undefined;
}

/** Glavni ulaz: XML string → stavke + ukupno (bez PDV) ako postoji u dokumentu. */
export function parseSupplierInvoiceXml(xml: string): ParsedUblDocument | null {
  const trimmed = xml.trim();
  if (!trimmed) return null;

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      removeNSPrefix: true,
      trimValues: true,
    });
    const parsed = parser.parse(trimmed);
    const inv = findInvoiceRoot(parsed);
    if (inv) {
      const lines = extractLinesFromInvoice(inv);
      if (lines.length > 0) {
        return {
          lines,
          taxExclusiveTotal: extractTaxExclusive(inv),
          documentNumber: extractDocumentId(inv),
        };
      }
    }
  } catch {
    /* pad na DOM parser */
  }

  return parseUblInvoiceLikeXml(trimmed);
}

export type { ParsedUblDocument, ParsedUblLine };
