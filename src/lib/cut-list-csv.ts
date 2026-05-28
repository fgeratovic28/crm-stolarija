/**
 * Parser izvoznih CSV krojnih listi (npr. tačka-zarez, zaglavlja kao profile_code / user_barcode).
 * Podržan je i stariji format sa zaglavljima „Profile Code“, „Cut Length“, itd.
 */

export type ParsedCutListRow = {
  profileCode: string;
  profileTitle: string;
  color: string;
  cutLength: number;
  quantity: number;
  barcode: string;
  metadata: Record<string, unknown>;
};

function cleanCell(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim();
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out.map((s) => cleanCell(s.replace(/^"|"$/g, "")));
}

/** Jedinstveni ključ kolone (npr. "reverse cutting" → "reverse_cutting"). */
function normalizeHeaderKey(raw: string): string {
  return cleanCell(raw)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}

function pickByNorm(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const nk = normalizeHeaderKey(k);
    const v = row[nk];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

function parseNumLoose(s: string): number {
  const n = Number(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

function isOstatakBarcode(barcode: string): boolean {
  const t = barcode.trim();
  if (!t) return true;
  if (/^ostatak$/i.test(t)) return true;
  return false;
}

function isLeftoverRow(row: Record<string, string>): boolean {
  const flag = pickByNorm(row, ["leftover_profile", "leftover profile"]);
  if (flag === "1" || flag.toLowerCase() === "true") return true;
  const n = parseNumLoose(flag);
  if (n === 1) return true;
  return false;
}

const METADATA_SKIP_NORM = new Set([
  "profile_code",
  "profile_title",
  "color",
  "cut_lenght",
  "cut_length",
  "quantity",
  "user_barcode",
  "leftover_profile",
]);

export function parseCutListCsvText(text: string): ParsedCutListRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "---");
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const rawHeaders = parseDelimitedLine(lines[0], delimiter);
  const normKeys = rawHeaders.map((h) => normalizeHeaderKey(h));
  const rows: ParsedCutListRow[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseDelimitedLine(lines[i], delimiter);
    const rowNorm: Record<string, string> = {};
    normKeys.forEach((nk, idx) => {
      rowNorm[nk] = cells[idx] ?? "";
    });

    if (isLeftoverRow(rowNorm)) continue;

    const profileCode = pickByNorm(rowNorm, ["profile_code", "profile code"]);
    const profileTitle = pickByNorm(rowNorm, ["profile_title", "profile title"]);
    const color = pickByNorm(rowNorm, ["color"]);
    const cutRaw = pickByNorm(rowNorm, ["cut_lenght", "cut_length", "cut length"]);
    const cutLength = parseNumLoose(cutRaw);
    const quantity = Math.round(parseNumLoose(pickByNorm(rowNorm, ["quantity"])));
    const barcode = pickByNorm(rowNorm, ["user_barcode", "user barcode"]);

    if (isOstatakBarcode(barcode)) continue;
    if (!profileTitle.trim() || !Number.isFinite(quantity) || quantity <= 0) continue;

    const metadata: Record<string, unknown> = {};
    rawHeaders.forEach((orig, idx) => {
      const nk = normKeys[idx] ?? normalizeHeaderKey(orig);
      if (METADATA_SKIP_NORM.has(nk)) return;
      const val = cells[idx] ?? "";
      if (val === "") return;
      metadata[orig.trim() || nk] = val;
    });

    rows.push({
      profileCode: profileCode.trim(),
      profileTitle: profileTitle.trim(),
      color: color.trim(),
      cutLength: Number.isFinite(cutLength) ? cutLength : 0,
      quantity,
      barcode: barcode.trim(),
      metadata,
    });
  }

  return rows;
}
