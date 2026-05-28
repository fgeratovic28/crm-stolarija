import type { VatRatePercent } from "@/lib/vat-constants";

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function vatRatioFromPercent(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate / 100;
}

/** Zbir stavki: ∑ (količina × jedinična cena), bez promene; značenje zavisi od `pricesIncludeVat` (bruto vs neto stavke). */
export function sumQuoteLineAmounts(lines: { quantity?: number; unitPrice?: number }[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

/**
 * - `vatRatePercent === 0`: nema obračunate PDV obaveze; ukupni iznos za naplatu = osnovica, PDV 0.
 * - `vatRatePercent > 0` i `pricesIncludeVat === true`: `lineSum` je ukupno sa uključenim PDV (bruto).
 * - `vatRatePercent > 0` i `pricesIncludeVat === false`: `lineSum` je neto (osnovica); PDV se dodaje na zbir.
 */
export function computeJobAmountsFromLineSum(
  lineSum: number,
  pricesIncludeVat: boolean,
  vatRatePercent: number = 0,
) {
  if (lineSum <= 0) return { totalPrice: 0, vatAmount: 0, priceWithoutVat: 0 };
  const r = vatRatioFromPercent(vatRatePercent);
  if (r <= 0) {
    const totalPrice = round2(lineSum);
    return { totalPrice, vatAmount: 0, priceWithoutVat: totalPrice };
  }
  if (pricesIncludeVat) {
    const totalPrice = round2(lineSum);
    const priceWithoutVat = round2(totalPrice / (1 + r));
    const vatAmount = round2(totalPrice - priceWithoutVat);
    return { totalPrice, vatAmount, priceWithoutVat };
  }
  const priceWithoutVat = round2(lineSum);
  const vatAmount = round2(priceWithoutVat * r);
  const totalPrice = round2(priceWithoutVat + vatAmount);
  return { totalPrice, vatAmount, priceWithoutVat };
}

/** Kada je poznat ukupan iznos za naplatu (`quotes.total_amount` / ručni unos). */
export function vatAmountsFromTotalDue(totalDue: number, vatRatePercent: number = 0) {
  if (totalDue <= 0) return { totalPrice: 0, vatAmount: 0, priceWithoutVat: 0 };
  const r = vatRatioFromPercent(vatRatePercent);
  const totalPrice = round2(totalDue);
  if (r <= 0) {
    return { totalPrice, vatAmount: 0, priceWithoutVat: totalPrice };
  }
  const priceWithoutVat = round2(totalPrice / (1 + r));
  const vatAmount = round2(totalPrice - priceWithoutVat);
  return { totalPrice, vatAmount, priceWithoutVat };
}

/** Raščlamanje ostalog duga proporcionalno osnovici/PDV (isti odnos kao kod ukupne cene). */
export function splitPaymentByJobVat(
  remainingDebt: number,
  jobTotal: number,
  basePortionTotal: number,
  vatPortionTotal: number,
): { base: number; vat: number } {
  if (remainingDebt <= 0 || !Number.isFinite(remainingDebt))
    return { base: 0, vat: 0 };
  if (!Number.isFinite(jobTotal) || jobTotal <= 0) {
    return { base: round2(remainingDebt), vat: 0 };
  }
  const vatAmt = Number.isFinite(vatPortionTotal) && vatPortionTotal > 0 ? vatPortionTotal : 0;
  const baseAmt = Number.isFinite(basePortionTotal) ? basePortionTotal : Math.max(0, jobTotal - vatAmt);
  if (vatAmt <= 0.009) return { base: round2(remainingDebt), vat: 0 };
  const ratio = remainingDebt / jobTotal;
  const vatPart = round2(vatAmt * ratio);
  const basePart = round2(remainingDebt - vatPart);
  return { base: basePart, vat: vatPart };
}

/** Normalizuje broj čitan iz babe (kolone `vat_rate_percent`). */
export function normalizeVatRatePercent(raw: unknown): VatRatePercent {
  const n = Number(raw);
  return n === 20 ? 20 : 0;
}
