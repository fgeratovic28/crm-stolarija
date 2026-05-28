/** Numeracija poslova — legacy (PO2026-055) ili numeric (226246). */

export type JobNumberFormat = "legacy" | "numeric";

export const JOB_PREFIX_MAX_LEN = 12;
export const JOB_NUMBER_MAX = 9_999_999_999;

const JOB_PREFIX_ALLOWED = /[^A-Za-zĆČĐŠŽćčđšž\-]/g;

export function parseJobNumberFormat(raw: unknown): JobNumberFormat {
  return raw === "numeric" ? "numeric" : "legacy";
}

export function sanitizeJobPrefixInput(raw: string): string {
  return raw.replace(JOB_PREFIX_ALLOWED, "").slice(0, JOB_PREFIX_MAX_LEN);
}

export function isValidJobPrefix(prefix: string): boolean {
  return sanitizeJobPrefixInput(prefix).length >= 1;
}

export function parseJobNextNumberInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 1 || n > JOB_NUMBER_MAX) return null;
  return n;
}

export function formatJobNextNumberInput(n: number): string {
  return String(Math.max(1, Math.min(JOB_NUMBER_MAX, Math.floor(n))));
}

export function formatLegacyJobNumberExample(prefix: string, year: number, nextSeq: number): string {
  const p = sanitizeJobPrefixInput(prefix) || "P";
  const seq = Math.max(1, Math.min(999, Math.floor(nextSeq)));
  return `${p}${year}-${String(seq).padStart(3, "0")}`;
}

export function formatNumericJobNumberExample(nextSeq: number): string {
  return formatJobNextNumberInput(nextSeq);
}
