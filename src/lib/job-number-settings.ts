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

export function getJobNumberYymmPrefix(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

/** Puni numerički broj posla: YYMM + redni (npr. 2606101). */
export function formatNumericJobNumberFull(nextSeq: number, date: Date = new Date()): string {
  const seq = Math.max(1, Math.min(JOB_NUMBER_MAX, Math.floor(nextSeq)));
  return `${getJobNumberYymmPrefix(date)}${String(seq).padStart(2, "0")}`;
}

/**
 * Za numerički format: prihvata redni broj (101) ili pun broj (2606101) i vraća redni deo.
 */
export function parseNumericJobNextSeqInput(raw: string, date: Date = new Date()): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const yymm = getJobNumberYymmPrefix(date);
  if (digits.startsWith(yymm) && digits.length > yymm.length) {
    const seq = Number.parseInt(digits.slice(yymm.length), 10);
    if (Number.isFinite(seq) && seq >= 1 && seq <= JOB_NUMBER_MAX) return seq;
  }
  return parseJobNextNumberInput(raw);
}

export function formatLegacyJobNumberExample(prefix: string, year: number, nextSeq: number): string {
  const p = sanitizeJobPrefixInput(prefix) || "P";
  const seq = Math.max(1, Math.min(999, Math.floor(nextSeq)));
  return `${p}${year}-${String(seq).padStart(3, "0")}`;
}

export function formatNumericJobNumberExample(nextSeq: number, date: Date = new Date()): string {
  return formatNumericJobNumberFull(nextSeq, date);
}
