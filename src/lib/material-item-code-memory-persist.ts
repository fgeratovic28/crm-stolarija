import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaterialOrderFormValues } from "@/lib/material-order-form-schema";
import { parseMaterialOrderItemsJson, rememberableCodesFromSmartJson } from "@/lib/material-order-items-json";
import {
  normalizeArticleLookupKey,
  normalizeItemCodeLookupKey,
  spreadsheetCellToPlainString,
  type ItemCodeLookupInput,
} from "@/lib/material-item-code-memory-keys";

/** Stavka za upsert u `material_item_code_memory` (šifra vezana za artikal / poziciju / dužinu). */
export type RememberableItemCode = ItemCodeLookupInput & { article_code?: string };

export type MaterialItemCodeMemoryUpsertRow = {
  normalized_lookup_key: string;
  normalized_article: string;
  article_name: string;
  position: string | null;
  length_mm: number | null;
  article_code: string;
  updated_at: string;
};

export function buildMaterialItemCodeMemoryUpsertRows(
  items: RememberableItemCode[],
): MaterialItemCodeMemoryUpsertRow[] {
  return items
    .map((item) => {
      const articlePlain = spreadsheetCellToPlainString(item.article);
      const code = String(item.article_code ?? "").trim();
      const positionPlain = spreadsheetCellToPlainString(item.position);
      const normalized = normalizeItemCodeLookupKey({
        article: articlePlain,
        position: positionPlain,
        lengthMm: item.lengthMm,
      });
      if (!normalized || !code) return null;
      const normalizedArticle = normalizeArticleLookupKey(articlePlain);
      const lengthMm =
        item.lengthMm != null && Number.isFinite(Number(item.lengthMm))
          ? Math.round(Number(item.lengthMm))
          : null;
      return {
        normalized_lookup_key: normalized,
        normalized_article: normalizedArticle,
        article_name: articlePlain,
        position: positionPlain || null,
        length_mm: lengthMm,
        article_code: code,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((x): x is MaterialItemCodeMemoryUpsertRow => Boolean(x));
}

/** Spajanje više izvora (Excel + ručni redovi) bez duplog ključa. */
export function mergeRememberableItemCodes(items: RememberableItemCode[]): RememberableItemCode[] {
  const byKey = new Map<string, RememberableItemCode>();
  for (const item of items) {
    const articlePlain = spreadsheetCellToPlainString(item.article);
    const code = String(item.article_code ?? "").trim();
    if (!articlePlain || !code) continue;
    const positionPlain = spreadsheetCellToPlainString(item.position);
    const k = normalizeItemCodeLookupKey({
      article: articlePlain,
      position: positionPlain,
      lengthMm: item.lengthMm,
    });
    if (!k) continue;
    byKey.set(k, {
      article: articlePlain,
      article_code: code,
      position: positionPlain || undefined,
      lengthMm: item.lengthMm,
    });
  }
  return Array.from(byKey.values());
}

export function rememberableCodesFromNbLinesForm(
  nbLines: MaterialOrderFormValues["nbLines"],
): RememberableItemCode[] {
  const out: RememberableItemCode[] = [];
  for (const line of nbLines) {
    const pm = line.procurementMeta;
    if (!pm) continue;
    const code = String(pm.article_code ?? "").trim();
    const article = spreadsheetCellToPlainString(pm.article ?? line.description ?? "");
    if (!article || !code) continue;
    out.push({
      article,
      article_code: code,
      position: pm.position,
      lengthMm: pm.length_mm ?? null,
    });
  }
  return out;
}

export function collectRememberableCodesFromMaterialOrderForm(
  data: Pick<MaterialOrderFormValues, "itemsJson" | "nbLines">,
): RememberableItemCode[] {
  const parts: RememberableItemCode[] = [];
  const json = parseMaterialOrderItemsJson(data.itemsJson);
  if (json) parts.push(...rememberableCodesFromSmartJson(json));
  parts.push(...rememberableCodesFromNbLinesForm(data.nbLines));
  return mergeRememberableItemCodes(parts);
}

export function mergeItemsIntoMemoryMap(
  prev: Record<string, string>,
  items: RememberableItemCode[],
): Record<string, string> {
  const next = { ...prev };
  for (const item of items) {
    const articlePlain = spreadsheetCellToPlainString(item.article);
    const code = String(item.article_code ?? "").trim();
    if (!articlePlain || !code) continue;
    const key = normalizeItemCodeLookupKey({
      article: articlePlain,
      position: spreadsheetCellToPlainString(item.position),
      lengthMm: item.lengthMm,
    });
    if (!key) continue;
    next[key] = code;
  }
  return next;
}

export async function upsertMaterialItemCodeMemory(
  client: SupabaseClient,
  items: RememberableItemCode[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  /** Jedan red po `normalized_lookup_key` — inače Postgres: "ON CONFLICT DO UPDATE cannot affect row a second time". */
  const merged = mergeRememberableItemCodes(items);
  const rows = buildMaterialItemCodeMemoryUpsertRows(merged);
  if (rows.length === 0) return { ok: true };
  const { error } = await client.from("material_item_code_memory").upsert(rows, {
    onConflict: "normalized_lookup_key",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
