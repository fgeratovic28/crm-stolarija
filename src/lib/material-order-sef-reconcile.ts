import type { MaterialOrder, MaterialOrderLine } from "@/types";
import type { ParsedUblLine } from "@/lib/sef-ubl-xml";
import { sumOrderLinesNet } from "@/lib/material-order-lines";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const QTY_EPS = 1e-4;
const MONEY_EPS = 0.02;

export type ReconciliationRow = {
  rowIndex: number;
  kind: "paired" | "crm_only" | "xml_only";
  crmDescription: string;
  crmQuantity: number;
  crmLineNet: number;
  xmlDescription: string;
  xmlQuantity: number | null;
  xmlLineNet: number | null;
  xmlUnitPrice: number | null;
  quantityDiffers: boolean;
  lineNetDiffers: boolean;
};

function unitPriceFromXml(line: ParsedUblLine): number | null {
  if (line.unitPriceNet != null && line.unitPriceNet > 0) return roundMoney(line.unitPriceNet);
  if (line.quantity > 0 && line.lineNet > 0) return roundMoney(line.lineNet / line.quantity);
  return null;
}

/** Poređenje stavki narudžbine i fakture (red po redu; višak CRM / XML posebno). */
export function buildReconciliationRows(crmLines: MaterialOrderLine[], xmlLines: ParsedUblLine[]): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];
  const pairCount = Math.min(crmLines.length, xmlLines.length);
  for (let i = 0; i < pairCount; i++) {
    const c = crmLines[i];
    const x = xmlLines[i];
    const qtyDiff = Math.abs(c.quantity - x.quantity) > QTY_EPS;
    const netDiff = Math.abs(c.lineNet - x.lineNet) > MONEY_EPS;
    rows.push({
      rowIndex: rows.length,
      kind: "paired",
      crmDescription: c.description || "—",
      crmQuantity: c.quantity,
      crmLineNet: c.lineNet,
      xmlDescription: x.description || "—",
      xmlQuantity: x.quantity,
      xmlLineNet: x.lineNet,
      xmlUnitPrice: unitPriceFromXml(x),
      quantityDiffers: qtyDiff,
      lineNetDiffers: netDiff,
    });
  }
  for (let i = pairCount; i < crmLines.length; i++) {
    const c = crmLines[i];
    rows.push({
      rowIndex: rows.length,
      kind: "crm_only",
      crmDescription: c.description || "—",
      crmQuantity: c.quantity,
      crmLineNet: c.lineNet,
      xmlDescription: "—",
      xmlQuantity: null,
      xmlLineNet: null,
      xmlUnitPrice: null,
      quantityDiffers: true,
      lineNetDiffers: true,
    });
  }
  for (let i = pairCount; i < xmlLines.length; i++) {
    const x = xmlLines[i];
    rows.push({
      rowIndex: rows.length,
      kind: "xml_only",
      crmDescription: "—",
      crmQuantity: 0,
      crmLineNet: 0,
      xmlDescription: x.description || "—",
      xmlQuantity: x.quantity,
      xmlLineNet: x.lineNet,
      xmlUnitPrice: unitPriceFromXml(x),
      quantityDiffers: true,
      lineNetDiffers: true,
    });
  }
  return rows;
}

export function reconciliationHasMismatch(rows: ReconciliationRow[]): boolean {
  return rows.some((r) => r.kind === "paired" && (r.quantityDiffers || r.lineNetDiffers));
}

export function reconciliationHasUnmatched(rows: ReconciliationRow[]): boolean {
  return rows.some((r) => r.kind === "crm_only" || r.kind === "xml_only");
}

/**
 * Primena fakture: parovi dobijaju količinu i iznos iz XML-a (sa `orderedQuantity`),
 * samo-CRM stavke ostaju, samo-XML se dodaju kao nove stavke.
 */
export function applyInvoiceReconciliationToOrder(
  order: MaterialOrder,
  crmLines: MaterialOrderLine[],
  xmlLines: ParsedUblLine[],
): MaterialOrder {
  const rows = buildReconciliationRows(crmLines, xmlLines);
  const partial = reconciliationHasMismatch(rows) || reconciliationHasUnmatched(rows);
  const today = new Date().toISOString().slice(0, 10);
  const pairCount = Math.min(crmLines.length, xmlLines.length);

  const newLines: MaterialOrderLine[] = [];

  for (let i = 0; i < pairCount; i++) {
    const c = crmLines[i];
    const x = xmlLines[i];
    const xmlQty = Math.max(0.0001, x.quantity > 0 ? x.quantity : c.quantity);
    const xmlNet = roundMoney(x.lineNet > 0 ? x.lineNet : c.lineNet);
    newLines.push({
      ...c,
      orderedQuantity: c.quantity,
      quantity: xmlQty,
      lineNet: xmlNet,
    });
  }
  for (let i = pairCount; i < crmLines.length; i++) {
    newLines.push({ ...crmLines[i] });
  }
  for (let i = pairCount; i < xmlLines.length; i++) {
    const x = xmlLines[i];
    newLines.push({
      description: x.description || "—",
      quantity: Math.max(0.0001, x.quantity > 0 ? x.quantity : 0.0001),
      unit: "kom",
      lineNet: roundMoney(x.lineNet || 0),
      materialType: order.materialType,
    });
  }

  const total = sumOrderLinesNet(newLines);

  return {
    ...order,
    nbLines: newLines,
    price: total,
    supplierPrice: total,
    deliveryStatus: partial ? "partial" : "delivered",
    deliveryDate: today,
    deliveryVerified: true,
    sefReconciliationAt: new Date().toISOString(),
  };
}
