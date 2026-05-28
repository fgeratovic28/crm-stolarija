/** Podržane stope PDV u CRM-u (izlazni obračun). */
export const VAT_RATE_CHOICES = [0, 20] as const;
export type VatRatePercent = (typeof VAT_RATE_CHOICES)[number];

/** Nova ponuda / novi posao: podrazumevano 20% PDV. */
export const DEFAULT_OUTGOING_VAT_RATE_PERCENT: VatRatePercent = 20;

/** Postojeći zapisi u bazi bez eksplicitne stope tretiraju se kao 0%. */
export const LEGACY_OUTGOING_VAT_RATE_PERCENT: VatRatePercent = 0;
