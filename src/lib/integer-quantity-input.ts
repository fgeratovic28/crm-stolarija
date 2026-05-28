/** Ceo broj komada — samo cifre, bez decimala. */

export function parseIntegerQuantityInput(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function clampIntegerQuantity(n: number, max?: number): number {
  const v = Math.max(0, Math.floor(n));
  if (max == null || !Number.isFinite(max)) return v;
  return Math.min(Math.max(0, Math.floor(max)), v);
}
