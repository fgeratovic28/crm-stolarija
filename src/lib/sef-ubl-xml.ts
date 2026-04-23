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
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].localName !== "LegalMonetaryTotal") continue;
    const legal = candidates[i];
    const tax =
      childrenByLocal(legal, "TaxExclusiveAmount")[0] ||
      childrenByLocal(legal, "TaxInclusiveAmount")[0] ||
      childrenByLocal(legal, "LineExtensionAmount")[0];
    if (tax) {
      const raw = textOf(tax);
      const v = parseNum(raw);
      if (raw) taxExclusiveTotal = v;
    }
    break;
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

  return { lines, taxExclusiveTotal, documentNumber };
}
