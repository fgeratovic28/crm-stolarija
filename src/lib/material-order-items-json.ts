import type { SheetPickResult } from "@/lib/procurement-excel-import";
import {
  PROCUREMENT_FIELD_ALIASES,
  extractRowsFromSheet,
  headerKeysFromRaw,
  matchColumnsByAliases,
  normalizeHeader,
  normalizedAlias,
  parseNumericCell,
  type ProcurementFieldKey,
} from "@/lib/procurement-excel-import";
import type { MaterialOrderLineFormValues } from "@/lib/material-order-form-schema";
import type { ItemCodeLookupInput } from "@/lib/material-item-code-memory-keys";
import { spreadsheetCellToPlainString } from "@/lib/material-item-code-memory-keys";

export const SIFRA_COLUMN_KEY = "__proc_sifra__";

export type MaterialOrderItemsJsonColumn = {
  key: string;
  label: string;
};

/** Verzija 1: dinamička tabela iz Excel-a + uvek prisutna kolona Šifra (ne štampa se u PDF tekstu). */
export type MaterialOrderItemsJsonV1 = {
  version: 1;
  columns: MaterialOrderItemsJsonColumn[];
  rows: Record<string, string>[];
  articleColumnKey: string;
  sifraColumnKey: string;
  quantityColumnKey: string;
  workOrderColumnKey?: string | null;
  positionColumnKey?: string | null;
  lengthColumnKey?: string | null;
  uomColumnKey?: string | null;
  colorColumnKey?: string | null;
};

function cellStr(row: Record<string, unknown>, key: string): string {
  return spreadsheetCellToPlainString(row[key]);
}

function stringifyRowValues(row: Record<string, unknown>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    out[k] = cellStr(row, k);
  }
  return out;
}

export function parseMaterialOrderItemsJson(raw: unknown): MaterialOrderItemsJsonV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (Number(o.version) !== 1) return null;
  const cols = o.columns;
  const rows = o.rows;
  if (!Array.isArray(cols) || !Array.isArray(rows)) return null;
  const columns: MaterialOrderItemsJsonColumn[] = [];
  for (const c of cols) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    const key = String(rec.key ?? "").trim();
    const label = String(rec.label ?? "").trim();
    if (!key) continue;
    columns.push({ key, label: label || key });
  }
  if (columns.length === 0 || rows.length === 0) return null;
  const articleColumnKey = String(o.articleColumnKey ?? "").trim();
  const sifraColumnKey = String(o.sifraColumnKey ?? SIFRA_COLUMN_KEY).trim();
  const quantityColumnKey = String(o.quantityColumnKey ?? "").trim();
  if (!articleColumnKey || !quantityColumnKey) return null;
  const keySet = new Set(columns.map((c) => c.key));
  if (!keySet.has(articleColumnKey) || !keySet.has(quantityColumnKey) || !keySet.has(sifraColumnKey)) return null;
  const cleanRows: Record<string, string>[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    const rec = r as Record<string, unknown>;
    const line: Record<string, string> = {};
    for (const k of keySet) {
      line[k] = String(rec[k] ?? "").trim();
    }
    cleanRows.push(line);
  }
  if (cleanRows.length === 0) return null;
  return {
    version: 1,
    columns,
    rows: cleanRows,
    articleColumnKey,
    sifraColumnKey,
    quantityColumnKey,
    workOrderColumnKey: o.workOrderColumnKey != null ? String(o.workOrderColumnKey).trim() || null : null,
    positionColumnKey: o.positionColumnKey != null ? String(o.positionColumnKey).trim() || null : null,
    lengthColumnKey: o.lengthColumnKey != null ? String(o.lengthColumnKey).trim() || null : null,
    uomColumnKey: o.uomColumnKey != null ? String(o.uomColumnKey).trim() || null : null,
    colorColumnKey: o.colorColumnKey != null ? String(o.colorColumnKey).trim() || null : null,
  };
}

/**
 * Ponovo popunjava prazne ćelije kolone Šifra iz memorije (npr. kad se memorija učita posle uvoza fajla).
 */
export function enrichSmartItemsJsonSifraFromResolver(
  json: MaterialOrderItemsJsonV1,
  resolveRememberedItemCode?: (input: ItemCodeLookupInput) => string | undefined,
): MaterialOrderItemsJsonV1 {
  if (!resolveRememberedItemCode) return json;
  if (!Array.isArray(json.rows) || !Array.isArray(json.columns)) return json;
  const sk = json.sifraColumnKey;
  let changed = false;
  const rows = json.rows.map((row) => {
    if (String(row[sk] ?? "").trim()) return row;
    const article = spreadsheetCellToPlainString(row[json.articleColumnKey]);
    const pos = json.positionColumnKey ? spreadsheetCellToPlainString(row[json.positionColumnKey] ?? "") : "";
    const lenRaw = json.lengthColumnKey ? spreadsheetCellToPlainString(row[json.lengthColumnKey] ?? "") : "";
    const lenNum = lenRaw ? parseNumericCell(lenRaw.replace(/\s/g, "")) : null;
    const remembered =
      resolveRememberedItemCode({
        article,
        position: pos || undefined,
        lengthMm: lenNum,
      }) ?? "";
    const t = remembered.trim();
    if (!t) return row;
    changed = true;
    return { ...row, [sk]: t };
  });
  if (!changed) return json;
  return { ...json, rows };
}

function firstMatchingHeaderKey(
  rawHeaders: string[],
  keys: string[],
  field: ProcurementFieldKey,
): string | undefined {
  const auto = matchColumnsByAliases(rawHeaders);
  const hit = auto[field];
  if (hit && keys.includes(hit)) return hit;
  for (let i = 0; i < rawHeaders.length; i += 1) {
    const k = keys[i];
    if (!k) continue;
    const nh = normalizeHeader(String(rawHeaders[i] ?? ""));
    if (!nh) continue;
    for (const a of PROCUREMENT_FIELD_ALIASES[field]) {
      if (normalizedAlias(a) === nh) return k;
    }
  }
  return undefined;
}

export function buildSmartItemsJsonFromSheetPick(
  pick: SheetPickResult,
  resolveRememberedItemCode?: (input: { article?: string; position?: string; lengthMm?: number | null }) =>
    | string
    | undefined,
): MaterialOrderItemsJsonV1 {
  const { rawHeaders } = pick.detection;
  const keys = headerKeysFromRaw(rawHeaders);
  const auto = matchColumnsByAliases(rawHeaders);

  const articleKey =
    (auto.article && keys.includes(auto.article) ? auto.article : undefined) ||
    firstMatchingHeaderKey(rawHeaders, keys, "article");
  const quantityKey =
    (auto.quantity && keys.includes(auto.quantity) ? auto.quantity : undefined) ||
    firstMatchingHeaderKey(rawHeaders, keys, "quantity");
  if (!articleKey) {
    throw new Error("Nije prepoznata kolona za naziv artikla (Naziv / Artikal / Opis).");
  }
  if (!quantityKey) {
    throw new Error("Nije prepoznata kolona za količinu. Proverite Excel ili dodajte kolonu „Količina”.");
  }

  const articleCodeSourceKey =
    auto.article_code && keys.includes(auto.article_code) ? auto.article_code : undefined;

  const positionKey =
    (auto.position && keys.includes(auto.position) ? auto.position : undefined) ||
    firstMatchingHeaderKey(rawHeaders, keys, "position");
  const lengthKey =
    (auto.length_mm && keys.includes(auto.length_mm) ? auto.length_mm : undefined) ||
    firstMatchingHeaderKey(rawHeaders, keys, "length_mm");
  const workKey =
    (auto.work_order && keys.includes(auto.work_order) ? auto.work_order : undefined) ||
    firstMatchingHeaderKey(rawHeaders, keys, "work_order");
  const uomKey =
    (auto.uom && keys.includes(auto.uom) ? auto.uom : undefined) || firstMatchingHeaderKey(rawHeaders, keys, "uom");
  const colorKey =
    (auto.color && keys.includes(auto.color) ? auto.color : undefined) || firstMatchingHeaderKey(rawHeaders, keys, "color");

  const columns: MaterialOrderItemsJsonColumn[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!key) continue;
    if (articleCodeSourceKey && key === articleCodeSourceKey) continue;
    const label = String(rawHeaders[i] ?? "")
      .replace(/^\uFEFF/, "")
      .replace(/^"|"$/g, "")
      .trim();
    columns.push({ key, label: label || key });
  }

  const artIdx = columns.findIndex((c) => c.key === articleKey);
  const insertAt = artIdx >= 0 ? artIdx + 1 : columns.length;
  columns.splice(insertAt, 0, { key: SIFRA_COLUMN_KEY, label: "Šifra" });

  const keyOrder = columns.map((c) => c.key);
  const rawRows = extractRowsFromSheet(pick.matrix, pick.detection);
  const rows: Record<string, string>[] = rawRows.map((row) => {
    const base = stringifyRowValues(row, keys);
    const article = cellStr(row, articleKey);
    const pos = positionKey ? cellStr(row, positionKey) : "";
    const lenRaw = lengthKey ? cellStr(row, lengthKey) : "";
    const lenNum = lenRaw ? parseNumericCell(lenRaw.replace(/\s/g, "")) : null;
    const fromExcelCode = articleCodeSourceKey ? cellStr(row, articleCodeSourceKey) : "";
    const remembered =
      resolveRememberedItemCode?.({
        article,
        position: pos,
        lengthMm: lenNum,
      }) ?? "";
    const sifra = (fromExcelCode || remembered).trim();
    const line: Record<string, string> = {};
    for (const k of keyOrder) {
      if (k === SIFRA_COLUMN_KEY) line[k] = sifra;
      else line[k] = base[k] ?? "";
    }
    return line;
  });

  return enrichSmartItemsJsonSifraFromResolver(
    {
      version: 1,
      columns,
      rows,
      articleColumnKey: articleKey,
      sifraColumnKey: SIFRA_COLUMN_KEY,
      quantityColumnKey: quantityKey,
      workOrderColumnKey: workKey ?? null,
      positionColumnKey: positionKey ?? null,
      lengthColumnKey: lengthKey ?? null,
      uomColumnKey: uomKey ?? null,
      colorColumnKey: colorKey ?? null,
    },
    resolveRememberedItemCode,
  );
}

export function smartItemsJsonToNbLineFormValues(json: MaterialOrderItemsJsonV1): MaterialOrderLineFormValues[] {
  if (!Array.isArray(json.rows)) return [];
  return json.rows.map((row) => {
    const article = String(row[json.articleColumnKey] ?? "").trim();
    const qtyRaw = row[json.quantityColumnKey];
    const qty = parseNumericCell(qtyRaw) ?? 0.0001;
    const safeQty = qty > 0 ? qty : 0.0001;
    const code = String(row[json.sifraColumnKey] ?? "").trim();
    const position = json.positionColumnKey ? String(row[json.positionColumnKey] ?? "").trim() : "";
    const work_order = json.workOrderColumnKey ? String(row[json.workOrderColumnKey] ?? "").trim() : "";
    const color = json.colorColumnKey ? String(row[json.colorColumnKey] ?? "").trim() : "";
    const uom = json.uomColumnKey ? String(row[json.uomColumnKey] ?? "").trim() : "";
    let length_mm: number | null = null;
    if (json.lengthColumnKey) {
      const lr = String(row[json.lengthColumnKey] ?? "").trim();
      if (lr) {
        const n = parseNumericCell(lr.replace(/\s/g, ""));
        length_mm = n != null && Number.isFinite(n) ? Math.round(n) : null;
      }
    }
    const chunks: string[] = [];
    if (work_order) chunks.push(`Nalog ${work_order}`);
    if (position) chunks.push(`Poz. ${position}`);
    if (code) chunks.push(`Šif. ${code}`);
    chunks.push(article || "—");
    if (color) chunks.push(color);
    if (length_mm != null) chunks.push(`${length_mm} mm`);
    const unit = uom || "kom";
    return {
      description: chunks.join(" · ") || article || "—",
      quantity: safeQty,
      unit,
      lineNet: 0,
      materialType: undefined,
      procurementMeta: {
        article: article || "—",
        ...(code ? { article_code: code } : {}),
        ...(position ? { position } : {}),
        ...(work_order ? { work_order } : {}),
        ...(color ? { color } : {}),
        ...(uom ? { uom } : {}),
        length_mm,
        manual_line: false,
      },
    };
  });
}

export function rememberableCodesFromSmartJson(json: MaterialOrderItemsJsonV1): Array<{
  article: string;
  article_code?: string;
  position?: string;
  lengthMm?: number | null;
}> {
  const out: Array<{ article: string; article_code?: string; position?: string; lengthMm?: number | null }> = [];
  if (!Array.isArray(json.rows)) return out;
  for (const row of json.rows) {
    const article = spreadsheetCellToPlainString(row[json.articleColumnKey]);
    const code = String(row[json.sifraColumnKey] ?? "").trim();
    if (!article || !code) continue;
    const position = json.positionColumnKey
      ? spreadsheetCellToPlainString(row[json.positionColumnKey] ?? "")
      : "";
    let lengthMm: number | null = null;
    if (json.lengthColumnKey) {
      const lr = String(row[json.lengthColumnKey] ?? "").trim();
      if (lr) {
        const n = parseNumericCell(lr.replace(/\s/g, ""));
        lengthMm = n != null && Number.isFinite(n) ? Math.round(n) : null;
      }
    }
    out.push({ article, article_code: code, position: position || undefined, lengthMm });
  }
  return out;
}

export function removeColumnFromItemsJson(
  json: MaterialOrderItemsJsonV1,
  key: string,
): { next: MaterialOrderItemsJsonV1; error?: string } {
  if (key === json.articleColumnKey) return { next: json, error: "Kolona artikla je obavezna." };
  if (key === json.quantityColumnKey) return { next: json, error: "Kolona količine je obavezna." };
  if (key === json.sifraColumnKey) return { next: json, error: "Kolona šifre je obavezna (ne štampa se u PDF)." };
  if (!Array.isArray(json.columns) || !Array.isArray(json.rows)) return { next: json, error: "Neispravan JSON tabele." };
  const clear = (k: string | null | undefined) => (k === key ? null : k);
  return {
    next: {
      ...json,
      columns: json.columns.filter((c) => c.key !== key),
      rows: json.rows.map((r) => {
        const copy = { ...r };
        delete copy[key];
        return copy;
      }),
      workOrderColumnKey: clear(json.workOrderColumnKey ?? null),
      positionColumnKey: clear(json.positionColumnKey ?? null),
      lengthColumnKey: clear(json.lengthColumnKey ?? null),
      uomColumnKey: clear(json.uomColumnKey ?? null),
      colorColumnKey: clear(json.colorColumnKey ?? null),
    },
  };
}

export function validateSmartItemsJson(json: MaterialOrderItemsJsonV1): string | null {
  if (!Array.isArray(json.columns) || !Array.isArray(json.rows)) {
    return "Tabela nema ispravne kolone ili redove.";
  }
  const keys = new Set(json.columns.map((c) => c.key));
  if (!keys.has(json.articleColumnKey) || !keys.has(json.quantityColumnKey) || !keys.has(json.sifraColumnKey)) {
    return "Tabela nema obavezne kolone (artikal, količina, šifra).";
  }
  for (let i = 0; i < json.rows.length; i += 1) {
    const row = json.rows[i];
    const article = String(row[json.articleColumnKey] ?? "").trim();
    if (!article) return `Red ${i + 1}: naziv artikla je prazan.`;
    const qty = parseNumericCell(row[json.quantityColumnKey]);
    if (qty == null || qty <= 0) return `Red ${i + 1}: količina mora biti broj veći od 0.`;
    if (json.lengthColumnKey) {
      const lr = String(row[json.lengthColumnKey] ?? "").trim();
      if (lr) {
        const n = parseNumericCell(lr.replace(/\s/g, ""));
        if (n == null || !Number.isFinite(n) || n < 0) {
          return `Red ${i + 1}: dužina mora biti broj ≥ 0.`;
        }
      }
    }
  }
  return null;
}
