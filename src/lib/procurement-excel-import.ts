import * as XLSX from "xlsx";

/** Normalized procurement line after parsing and validation — PDF i `procurementMeta` na stavci. */
export type ImportedOrderItem = {
  position?: string;
  /** Radni nalog / broj naloga iz fajla (opciono). */
  work_order?: string;
  article: string;
  article_code?: string;
  color?: string;
  uom?: string;
  length_mm?: number | null;
  quantity: number;
  raw_row: Record<string, unknown>;
  /** Za fiksni barkod: true = ručno (`M-`), false = uvoz (`I-`). */
  manual_line?: boolean;
};

export type ProcurementFieldKey =
  | "position"
  | "work_order"
  | "article_code"
  | "article"
  | "color"
  | "length_mm"
  | "quantity"
  | "uom";

/** Redosled za automatsko mapiranje kolona (prvo obavezna polja). */
export const PROCUREMENT_FIELD_MATCH_ORDER: ProcurementFieldKey[] = [
  "article",
  "quantity",
  "position",
  "length_mm",
  "work_order",
  "article_code",
  "color",
  "uom",
];

export const PROCUREMENT_FIELD_LABELS: Record<ProcurementFieldKey, string> = {
  work_order: "Radni nalog (NALOG)",
  position: "Pozicija (POZ)",
  article_code: "Šifra artikla",
  article: "Artikal *",
  color: "Boja / dekor",
  length_mm: "Dužina (mm)",
  quantity: "Količina *",
  uom: "Jedinica mere (JM)",
};

/** Kraći naslovi u mapiranju / PDF zaglavljima da forma bude kompaktnija. */
export const PROCUREMENT_FIELD_LABELS_COMPACT: Record<ProcurementFieldKey, string> = {
  work_order: "Nalog",
  position: "Poz.",
  article_code: "Šifra",
  article: "Artikal *",
  color: "Boja",
  length_mm: "Duž. mm",
  quantity: "Kol. *",
  uom: "JM",
};

/** Redosled dropdown-a u formi (UX). */
export const PROCUREMENT_FIELD_UI_ORDER: ProcurementFieldKey[] = [
  "work_order",
  "position",
  "article_code",
  "article",
  "color",
  "length_mm",
  "quantity",
  "uom",
];

/** Normalized synonyms (applied through `normalizeHeader` for comparison). */
export const PROCUREMENT_FIELD_ALIASES: Record<ProcurementFieldKey, readonly string[]> = {
  position: ["pozicija_br", "poz.br", "poz_br", "pozicija", "rb", "redni_broj"],
  work_order: ["nalog", "broj_naloga", "radni_nalog", "order_no"],
  article_code: ["sifra", "sifra_profila", "kod", "item_code"],
  article: ["artikal", "naziv", "opis", "item", "product"],
  color: ["boja", "dekor", "color"],
  length_mm: ["duzina_mm", "dužina", "duzina", "length", "length_mm"],
  quantity: ["kolicina", "količina", "komada", "qty", "quantity"],
  uom: ["jm", "jedinica_mere", "mera", "uom"],
};

const SERBIAN_LATIN_LOWER: Array<[RegExp | string, string]> = [
  [/č/g, "c"],
  [/ć/g, "c"],
  [/đ/g, "dj"],
  [/ž/g, "z"],
  [/š/g, "s"],
  [/Č/g, "c"],
  [/Ć/g, "c"],
  [/Đ/g, "dj"],
  [/Ž/g, "z"],
  [/Š/g, "s"],
];

function stripBomQuotes(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/^"|"$/g, "").trim();
}

/** Trim, BOM, lowercase, transliterate Serbian diacritics, replace spaces/dots/dashes → underscores. */
export function normalizeHeader(value: string): string {
  let s = stripBomQuotes(String(value ?? ""));
  for (const [re, repl] of SERBIAN_LATIN_LOWER) {
    s = s.replace(typeof re === "string" ? new RegExp(re, "g") : re, repl);
  }
  s = s.toLowerCase();
  s = s.replace(/\s+/g, "_").replace(/\./g, "_").replace(/-/g, "_");
  s = s.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return s;
}

export function normalizedAlias(alias: string): string {
  return normalizeHeader(alias);
}

const PROCUREMENT_KEYWORDS_PATTERN =
  /\b(rb|qty|kom|artik|profil|materij|nabav|opis|naziv|pozici|kol|quantity|product|length|duž|duz|nalog|boja|sifra|kod|jm|mera|uom|dekor)\b/i;

/** True if normalized header resembles procurement tabular columns. */
export function normalizedHeaderLooksProcurement(norm: string): boolean {
  if (!norm || norm.length < 2) return false;
  for (const key of Object.keys(PROCUREMENT_FIELD_ALIASES) as ProcurementFieldKey[]) {
    for (const a of PROCUREMENT_FIELD_ALIASES[key]) {
      if (normalizedAlias(a) === norm) return true;
    }
  }
  return PROCUREMENT_KEYWORDS_PATTERN.test(norm.replace(/_/g, " "));
}

function aliasScoreWeight(key: ProcurementFieldKey): number {
  if (key === "article" || key === "quantity") return 40;
  if (key === "length_mm") return 15;
  return 8;
}

export type SheetMatrix = unknown[][];

export function workbookSheetToAoA(ws: XLSX.WorkSheet): SheetMatrix {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];
}

export type HeaderDetectionResult = {
  headerRowIndex: number;
  rawHeaders: string[];
};

const MAX_SCAN_ROWS = 24;

/** Choose the row whose cells best explain the following rows as procurement table; prefer rows that match aliases. */
export function detectHeaderRow(matrix: SheetMatrix): HeaderDetectionResult | null {
  if (!matrix || matrix.length === 0) return null;
  const maxRow = Math.min(matrix.length - 1, MAX_SCAN_ROWS - 1);
  let best: { idx: number; rawHeaders: string[]; score: number } | null = null;

  for (let r = 0; r <= maxRow; r += 1) {
    const row = matrix[r] ?? [];
    const cells = row.map((c) => stripBomQuotes(String(c ?? "").trim())).filter(Boolean);
    if (cells.length < 2) continue;

    const rawHeaders = row.map((c) => stripBomQuotes(String(c ?? "")));
    const normalizedCells = cells.map((h) => normalizeHeader(h)).filter(Boolean);
    if (normalizedCells.length < 2) continue;

    const keywordHits = normalizedCells.filter(normalizedHeaderLooksProcurement).length;
    let aliasScore = 0;
    const seen = new Set<string>();
    for (const nh of normalizedCells) {
      if (seen.has(nh)) continue;
      seen.add(nh);
      for (const key of Object.keys(PROCUREMENT_FIELD_ALIASES) as ProcurementFieldKey[]) {
        for (const a of PROCUREMENT_FIELD_ALIASES[key]) {
          if (normalizedAlias(a) === nh) {
            aliasScore += aliasScoreWeight(key);
          }
        }
      }
    }

    let dataHint = 0;
    const dataStart = r + 1;
    const sampleEnd = Math.min(matrix.length - 1, dataStart + 12);
    for (let rr = dataStart; rr <= sampleEnd; rr += 1) {
      const dr = matrix[rr];
      if (!dr) continue;
      const nonEmpty = dr.filter((c) => stripBomQuotes(String(c ?? "").trim()).length > 0).length;
      if (nonEmpty >= 2) dataHint += 1;
    }

    const score = aliasScore + keywordHits * 5 + dataHint;

    if (!best || score > best.score) {
      best = { idx: r, rawHeaders, score };
    }
  }

  if (!best) return null;
  const trimmedHeaders = [...best.rawHeaders];
  while (trimmedHeaders.length > 0 && stripBomQuotes(String(trimmedHeaders[trimmedHeaders.length - 1] ?? "")) === "") {
    trimmedHeaders.pop();
  }

  const nonBlank = trimmedHeaders.filter((h) => stripBomQuotes(String(h ?? "").trim()).length > 0);
  if (nonBlank.length < 2) return null;

  return { headerRowIndex: best.idx, rawHeaders: trimmedHeaders };
}

/** Stable object keys aligned with {@link extractRowsFromSheet}. */
export function headerKeysFromRaw(rawHeaders: string[]): string[] {
  return rawHeaders.map((h, i) => {
    const t = stripBomQuotes(String(h)).trim();
    return t.length > 0 ? t : `__col_${i}`;
  });
}

/** Map canonical field → column key identical to keys in extracted row objects. */
export function matchColumnsByAliases(rawHeaders: string[]): Partial<Record<ProcurementFieldKey, string>> {
  const keys = headerKeysFromRaw(rawHeaders);
  const out: Partial<Record<ProcurementFieldKey, string>> = {};
  const usedIndices = new Set<number>();

  for (const field of PROCUREMENT_FIELD_MATCH_ORDER) {
    outer: for (const alias of PROCUREMENT_FIELD_ALIASES[field]) {
      const want = normalizedAlias(alias);
      for (let i = 0; i < rawHeaders.length; i += 1) {
        if (usedIndices.has(i)) continue;
        const rawCell = stripBomQuotes(String(rawHeaders[i] ?? "").trim());
        if (!rawCell) continue;
        if (normalizeHeader(rawHeaders[i]) !== want) continue;
        out[field] = keys[i];
        usedIndices.add(i);
        break outer;
      }
    }
  }

  return out;
}

/** Build row objects keyed by trimmed header text or synthetic `__col_i` placeholders. */
export function extractRowsFromSheet(matrix: SheetMatrix, detection: HeaderDetectionResult): Record<string, unknown>[] {
  const { headerRowIndex, rawHeaders } = detection;
  const keys = headerKeysFromRaw(rawHeaders);

  const out: Record<string, unknown>[] = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r += 1) {
    const line = matrix[r] ?? [];
    const row: Record<string, unknown> = {};
    let any = false;
    for (let c = 0; c < keys.length; c += 1) {
      const v = line[c];
      const key = keys[c];
      row[key] = v === undefined || v === "" ? "" : v;
      if (row[key] !== "" && row[key] != null) any = true;
    }
    if (any) out.push(row);
  }
  return out;
}

export type ColumnMapping = Partial<Record<ProcurementFieldKey, string | undefined>>;
export type RowValidationIssue = {
  rowIndex: number;
  message: string;
};

/** Parse quantity / length tolerant of commas. */
export function parseNumericCell(value: unknown): number | null {
  const s = stripBomQuotes(String(value ?? "").trim()).replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function optionalMappedString(raw_row: Record<string, unknown>, colKey: string | undefined): string | undefined {
  if (!colKey) return undefined;
  const s = stripBomQuotes(String(raw_row[colKey] ?? "").trim());
  return s.length > 0 ? s : undefined;
}

export type ValidationResult =
  | { ok: true; items: ImportedOrderItem[] }
  | { ok: false; issues: RowValidationIssue[]; partial: ImportedOrderItem[] };

/** Validate mapped rows: artikal i količina obavezni; dužina ako je mapirana mora biti broj. */
export function validateImportedRows(
  rows: Record<string, unknown>[],
  columnMap: Required<Pick<ColumnMapping, "article" | "quantity">> & Partial<ColumnMapping>,
): ValidationResult {
  const issues: RowValidationIssue[] = [];
  const partial: ImportedOrderItem[] = [];

  if (!columnMap.article || !columnMap.quantity) {
    return {
      ok: false,
      issues: [{ rowIndex: -1, message: "Nedostaje mapiranje za naziv artikla ili količinu." }],
      partial: [],
    };
  }

  rows.forEach((raw_row, idx) => {
    const article = stripBomQuotes(String(raw_row[columnMap.article!] ?? "").trim());
    const qtyRaw = raw_row[columnMap.quantity!];
    const position = optionalMappedString(raw_row, columnMap.position);
    const work_order = optionalMappedString(raw_row, columnMap.work_order);
    const article_code = optionalMappedString(raw_row, columnMap.article_code);
    const color = optionalMappedString(raw_row, columnMap.color);
    const uom = optionalMappedString(raw_row, columnMap.uom);

    const lenCol =
      columnMap.length_mm !== undefined && columnMap.length_mm !== "" ? raw_row[columnMap.length_mm] : undefined;
    const lenTrimmed =
      columnMap.length_mm && lenCol !== undefined && lenCol !== null ? stripBomQuotes(String(lenCol)).trim() : "";

    let length_mm: number | null | undefined;
    if (columnMap.length_mm) {
      if (lenTrimmed === "") length_mm = null;
      else {
        const pn = parseNumericCell(lenTrimmed);
        if (pn === null) {
          issues.push({ rowIndex: idx, message: `Red ${idx + 1}: dužina mora biti broj.` });
          return;
        }
        length_mm = pn;
      }
    }

    if (!article) {
      issues.push({ rowIndex: idx, message: `Red ${idx + 1}: naziv artikla je obavezan.` });
      return;
    }

    const qty = parseNumericCell(qtyRaw);
    if (qty === null || qty <= 0) {
      issues.push({ rowIndex: idx, message: `Red ${idx + 1}: količina mora biti broj veći od 0.` });
      return;
    }

    const item: ImportedOrderItem = {
      ...(position ? { position } : {}),
      ...(work_order ? { work_order } : {}),
      ...(article_code ? { article_code } : {}),
      article,
      ...(color ? { color } : {}),
      ...(uom ? { uom } : {}),
      quantity: qty,
      raw_row,
    };
    if (columnMap.length_mm) {
      item.length_mm = length_mm === undefined ? null : length_mm;
    }

    partial.push(item);
  });

  if (issues.length > 0) return { ok: false, issues, partial };
  return { ok: true, items: partial };
}

export type SheetPickResult = {
  sheetName: string;
  matrix: SheetMatrix;
  detection: HeaderDetectionResult;
  autoMap: Partial<Record<ProcurementFieldKey, string>>;
  score: number;
};

function scoreSheetCandidate(matrix: SheetMatrix, detection: HeaderDetectionResult, autoMap: Partial<Record<ProcurementFieldKey, string>>): number {
  const dataRows = extractRowsFromSheet(matrix, detection);
  const hasArticle = !!autoMap.article;
  const hasQty = !!autoMap.quantity;
  let extra = 0;
  for (const k of ["position", "length_mm", "work_order", "article_code", "color", "uom"] as const) {
    if (autoMap[k]) extra += 3;
  }
  const depth = Math.min(dataRows.length, 500);
  return (hasArticle ? 200 : 0) + (hasQty ? 200 : 0) + extra + depth;
}

/** Pick the worksheet that looks most like a procurement table. */
export function detectBestProcurementSheet(workbook: XLSX.WorkBook): SheetPickResult | null {
  let best: SheetPickResult | null = null;
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const matrix = workbookSheetToAoA(ws);
    const detection = detectHeaderRow(matrix);
    if (!detection) continue;
    const headerStrings = detection.rawHeaders.map((h) => stripBomQuotes(String(h)).trim()).filter(Boolean);
    if (headerStrings.length < 2) continue;
    const autoMap = matchColumnsByAliases(detection.rawHeaders);
    const score = scoreSheetCandidate(matrix, detection, autoMap);
    if (!best || score > best.score) {
      best = { sheetName, matrix, detection, autoMap, score };
    }
  }
  return best;
}

export function loadWorkbookFromArrayBuffer(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "array" });
}

export const PROCUREMENT_COLUMN_NONE = "__none__";

export type ProcurementUIMapping = Record<ProcurementFieldKey, string>;

export function initialProcurementMappingNone(): ProcurementUIMapping {
  return {
    work_order: PROCUREMENT_COLUMN_NONE,
    position: PROCUREMENT_COLUMN_NONE,
    article_code: PROCUREMENT_COLUMN_NONE,
    article: PROCUREMENT_COLUMN_NONE,
    color: PROCUREMENT_COLUMN_NONE,
    length_mm: PROCUREMENT_COLUMN_NONE,
    quantity: PROCUREMENT_COLUMN_NONE,
    uom: PROCUREMENT_COLUMN_NONE,
  };
}

export function isRequiredProcurementMapped(m: ProcurementUIMapping): boolean {
  return m.article !== PROCUREMENT_COLUMN_NONE && m.quantity !== PROCUREMENT_COLUMN_NONE;
}

/** Mapa kolona za {@link validateImportedRows}. */
export function procurementColumnMapFromUI(
  m: ProcurementUIMapping,
): (Required<Pick<ColumnMapping, "article" | "quantity">> & Partial<ColumnMapping>) | null {
  if (m.article === PROCUREMENT_COLUMN_NONE || m.quantity === PROCUREMENT_COLUMN_NONE) return null;
  const out: Required<Pick<ColumnMapping, "article" | "quantity">> & Partial<ColumnMapping> = {
    article: m.article,
    quantity: m.quantity,
  };
  const optionalKeys: ProcurementFieldKey[] = [
    "position",
    "length_mm",
    "work_order",
    "article_code",
    "color",
    "uom",
  ];
  for (const k of optionalKeys) {
    if (m[k] !== PROCUREMENT_COLUMN_NONE) out[k] = m[k];
  }
  return out;
}

export type HeaderDropdownOption = { value: string; label: string };

export function headerDropdownOptions(rawHeaders: string[]): HeaderDropdownOption[] {
  const keys = headerKeysFromRaw(rawHeaders);
  return keys.map((value, i) => ({
    value,
    label: stripBomQuotes(String(rawHeaders[i] ?? "").trim()) || `Kolona ${i + 1}`,
  }));
}

export function parseDelimitedLine(line: string, delimiter: string): string[] {
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
  return out.map((s) => s.replace(/^"|"$/g, "").trim());
}

/** Each non-empty CSV/TSV line becomes one matrix row. */
export function delimiterTextToMatrix(content: string): SheetMatrix {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "---");
  if (lines.length === 0) return [];
  const delim = lines[0].includes("\t") ? "\t" : ";";
  return lines.map((line) => parseDelimitedLine(line, delim));
}

/** Single-sheet analysis (CSV or ad-hoc matrix). */
export function analyzeProcurementMatrix(matrix: SheetMatrix, logicalSheetLabel = "CSV"): SheetPickResult | null {
  const detection = detectHeaderRow(matrix);
  if (!detection) return null;
  const headerStrings = detection.rawHeaders.map((h) => stripBomQuotes(String(h ?? "").trim())).filter(Boolean);
  if (headerStrings.length < 2) return null;
  const autoMap = matchColumnsByAliases(detection.rawHeaders);
  const score = scoreSheetCandidate(matrix, detection, autoMap);
  return { sheetName: logicalSheetLabel, matrix, detection, autoMap, score };
}

/** True when automatski prepoznati artikal i količina. */
export function autoProcurementSuggestionIsComplete(auto: Partial<Record<ProcurementFieldKey, string>>): boolean {
  return !!(auto.article && auto.quantity);
}
