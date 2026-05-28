/** Parsiranje i formatiranje iznosa u RSD (zarez kao decimalni separator). */

export function roundMoneyInput(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Parsira unos korisnika: `1200,50`, `1200.50`, `1.200,50`, `120000`.
 * Vraća `null` za prazno ili neispravno.
 */
export function parseMoneyInput(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;

  let norm = t;
  const lastComma = norm.lastIndexOf(",");
  const lastDot = norm.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      norm = norm.replace(/\./g, "").replace(",", ".");
    } else {
      norm = norm.replace(/,/g, "");
    }
  } else {
    norm = norm.replace(",", ".");
  }

  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoneyInput(n);
}

/** Dozvoljeni znakovi tokom kucanja; najviše 2 decimale posle zareza (tačka → zarez). */
export function sanitizeMoneyInputTyping(raw: string): string {
  let s = raw.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const lastComma = s.lastIndexOf(",");
  if (lastComma < 0) return s.replace(/,/g, "");

  const intPart = s.slice(0, lastComma).replace(/,/g, "");
  const fracPart = s.slice(lastComma + 1).replace(/,/g, "").slice(0, 2);
  if (s.endsWith(",") && fracPart.length === 0) return `${intPart},`;
  if (fracPart.length === 0) return intPart;
  return `${intPart},${fracPart}`;
}

/** Posle blur-a: zaokruži na 2 decimale i prikaži sr-RS (npr. `12.345,67`). */
export function formatMoneyInputOnBlur(raw: string): string {
  const n = parseMoneyInput(raw);
  if (n == null) return "";
  return formatMoneyInputDisplay(n);
}

export function formatMoneyInputDisplay(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("sr-RS", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Inicijalna vrednost iz broja u bazi (0 → prazno). */
export function moneyInputStringFromNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return formatMoneyInputDisplay(roundMoneyInput(value));
}
