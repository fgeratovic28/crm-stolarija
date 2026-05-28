/**
 * Gruba ekstrakcija stavki iz UBL e-računa (često u SEF XML-u) — bez namespace zavisnosti.
 * Podržava tipične elemente: InvoiceLine, CreditNoteLine.
 */

export type ParsedUblLine = {
  description: string;
  quantity: number;
  lineNet: number;
  /** Jedinična cena bez PDV ako je u XML-u (Price/PriceAmount). */
  unitPriceNet?: number;
};

export type ParsedUblDocument = {
  lines: ParsedUblLine[];
  taxExclusiveTotal: number | null;
  taxInclusiveTotal: number | null;
  /** Ukupan PDV ako ga XML eksplicitno nosi (TaxTotal ili razlika ukupno vs bez PDV). */
  documentVatAmount: number | null;
  /** Broj dokumenta ako postoji u XML-u. */
  documentNumber?: string;
};

function textOf(el: Element | null | undefined): string {
  return el?.textContent?.trim().replace(/\s+/g, " ") ?? "";
}

function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function childrenByLocal(parent: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.localName === local) out.push(c as Element);
  }
  return out;
}

function deepChildLocal(parent: Element, local: string): Element | null {
  const stack: Element[] = [parent];
  while (stack.length) {
    const el = stack.pop()!;
    if (el.localName === local) return el;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i] as Element);
  }
  return null;
}

export function parseUblInvoiceLikeXml(xml: string): ParsedUblDocument | null {
  const trimmed = xml.trim();
  if (!trimmed) return null;

  const doc = new DOMParser().parseFromString(trimmed, "text/xml");
  if (doc.querySelector("parsererror")) return null;

  const root = doc.documentElement;
  if (!root) return null;

  const lineLocals = ["InvoiceLine", "CreditNoteLine"];
  const lines: ParsedUblLine[] = [];

  const candidates = root.getElementsByTagName("*");
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (!lineLocals.includes(el.localName)) continue;

    const item = deepChildLocal(el, "Item");
    const nameEl = item ? deepChildLocal(item, "Name") : null;
    const desc = nameEl ? textOf(nameEl) : "";

    const qtyEl =
      deepChildLocal(el, "InvoicedQuantity") ||
      deepChildLocal(el, "CreditedQuantity") ||
      deepChildLocal(el, "Quantity");
    const qty = parseNum(textOf(qtyEl));

    const amtEl = deepChildLocal(el, "LineExtensionAmount");
    const lineNet = parseNum(textOf(amtEl));

    lines.push({
      description: desc || "—",
      quantity: qty,
      lineNet,
    });
  }

  let taxExclusiveTotal: number | null = null;
  let taxInclusiveTotal: number | null = null;
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].localName !== "LegalMonetaryTotal") continue;
    const legal = candidates[i];
    const excEl = childrenByLocal(legal, "TaxExclusiveAmount")[0];
    const incEl = childrenByLocal(legal, "TaxInclusiveAmount")[0];
    const fallbackEl =
      excEl || incEl || childrenByLocal(legal, "LineExtensionAmount")[0] || childrenByLocal(legal, "PayableAmount")[0];
    if (excEl) {
      const raw = textOf(excEl);
      if (raw) taxExclusiveTotal = parseNum(raw);
    }
    if (incEl) {
      const raw = textOf(incEl);
      if (raw) taxInclusiveTotal = parseNum(raw);
    }
    if (taxExclusiveTotal == null && fallbackEl && !excEl) {
      const raw = textOf(fallbackEl);
      if (raw) taxExclusiveTotal = parseNum(raw);
    }
    break;
  }

  let documentVatAmount: number | null = null;
  if (
    taxInclusiveTotal != null &&
    taxExclusiveTotal != null &&
    taxInclusiveTotal > 0 &&
    taxInclusiveTotal + 0.02 >= taxExclusiveTotal
  ) {
    documentVatAmount = Math.round((taxInclusiveTotal - taxExclusiveTotal) * 100) / 100;
    if (documentVatAmount < 0) documentVatAmount = null;
  }
  if (documentVatAmount == null) {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].localName !== "TaxTotal") continue;
      const tt = candidates[i];
      const amt = childrenByLocal(tt, "TaxAmount")[0];
      if (amt) {
        const raw = textOf(amt);
        const v = parseNum(raw);
        if (raw && v > 0) {
          documentVatAmount = Math.round(v * 100) / 100;
          break;
        }
      }
    }
  }

  let documentNumber: string | undefined;
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i] as Element;
    if (c.localName === "ID") {
      const t = textOf(c);
      if (t.length > 0 && t.length < 120) documentNumber = t;
      break;
    }
  }

  return { lines, taxExclusiveTotal, taxInclusiveTotal, documentVatAmount, documentNumber };
}
