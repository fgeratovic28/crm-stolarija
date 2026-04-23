const VAT_RATE = 0.2;

/** Zbir stavki ponude (količina × jedinična cena), bez dodatnog obračuna PDV-a. */
export function sumQuoteLineAmounts(lines: { quantity?: number; unitPrice?: number }[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

/** Ako je uključeno, dodaje 20% PDV na zbir stavki; inače PDV ostaje 0. */
export function computeJobAmountsFromLineSum(lineSum: number, pricesIncludeVat: boolean) {
  if (lineSum <= 0) return { totalPrice: 0, vatAmount: 0, priceWithoutVat: 0 };
  if (pricesIncludeVat) {
    const priceWithoutVat = Math.round(lineSum * 100) / 100;
    const vatAmount = Math.round(priceWithoutVat * VAT_RATE * 100) / 100;
    const totalPrice = Math.round((priceWithoutVat + vatAmount) * 100) / 100;
    return { totalPrice, vatAmount, priceWithoutVat };
  }
  const totalPrice = Math.round(lineSum * 100) / 100;
  return { totalPrice, vatAmount: 0, priceWithoutVat: totalPrice };
}
