/** Ulaz za lookup šifre u memoriji (artikal / pozicija / dužina). */
export type ItemCodeLookupInput = {
  article?: string;
  position?: string;
  lengthMm?: number | null;
};

function stripInvisibleAndNbsp(value: string): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\u2007/g, " ")
    .replace(/\u202f/g, " ")
    .replace(/\u3000/g, " ");
}

/** Vrednost ćelije iz Excel-a: trim, NBSP, nevidljivi znakovi, navodnici. */
export function spreadsheetCellToPlainString(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  return stripInvisibleAndNbsp(String(raw)).replace(/^"|"$/g, "").trim();
}

/** Ključ za mapu memorije šifri (case-insensitive, NBSP i suvišni razmaci). */
export function normalizeArticleLookupKey(value: string): string {
  return stripInvisibleAndNbsp(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Kompozitni ključ za `material_item_code_memory.normalized_lookup_key`. */
export function normalizeItemCodeLookupKey(input: ItemCodeLookupInput): string {
  const article = normalizeArticleLookupKey(spreadsheetCellToPlainString(String(input.article ?? "")));
  let position = normalizeArticleLookupKey(spreadsheetCellToPlainString(String(input.position ?? "")));
  /** Excel često šalje "01" / "001" za istu poziciju kao "1" — ujednačeno u ključu. */
  if (position && /^\d+$/.test(position.replace(/\s/g, ""))) {
    position = String(parseInt(position.replace(/\s/g, ""), 10));
  }
  const lengthRaw = input.lengthMm;
  const length =
    lengthRaw != null && Number.isFinite(Number(lengthRaw))
      ? String(Math.round(Number(lengthRaw)))
      : "";
  if (article && (position || length)) {
    return `a:${article}|p:${position || "-"}|l:${length || "-"}`;
  }
  return article;
}

/** Uskladi stari zapis ključa (npr. p:01) sa novim kanonskim oblikom (p:1). */
export function canonicalizeStoredMemoryLookupKey(full: string): string {
  const t = full.trim();
  const parts = t.split("|");
  if (parts.length !== 3 || !parts[0].startsWith("a:") || !parts[1].startsWith("p:") || !parts[2].startsWith("l:")) {
    return t;
  }
  const a = parts[0].slice(2);
  let p = parts[1].slice(2);
  const l = parts[2].slice(2);
  if (p && p !== "-" && /^\d+$/.test(p)) p = String(parseInt(p, 10));
  return `a:${a}|p:${p || "-"}|l:${l || "-"}`;
}

function parseCompositeMemoryKey(key: string): { article: string; position: string; length: string } | null {
  const t = key.trim();
  const m = /^a:(.+)\|p:(.+)\|l:(.+)$/.exec(t);
  if (!m) return null;
  return { article: m[1], position: m[2], length: m[3] };
}

/** Isti segment `p:` kao u {@link normalizeItemCodeLookupKey} (brojevi bez vodećih nula). */
function memoryPositionSegmentFromRaw(positionRaw: string): string {
  const t = normalizeArticleLookupKey(spreadsheetCellToPlainString(String(positionRaw ?? "")));
  if (!t) return "-";
  if (/^\d+$/.test(t.replace(/\s/g, ""))) return String(parseInt(t.replace(/\s/g, ""), 10));
  return t;
}

function memoryPositionSegmentsMatch(segFromKey: string, userPositionRaw: string): boolean {
  if (!userPositionRaw.trim()) return true;
  return memoryPositionSegmentFromRaw(segFromKey) === memoryPositionSegmentFromRaw(userPositionRaw);
}

function uniqueNonEmpty(codes: string[]): string[] {
  return [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
}

/**
 * Pronalazi šifru u memoriji uz više varijanti ključa (Excel kolone / redosled fajlova ne moraju biti identični).
 */
export function lookupItemCodeInMemoryMap(
  memory: Record<string, string>,
  lookup: ItemCodeLookupInput,
): string | undefined {
  const articlePlain = spreadsheetCellToPlainString(String(lookup.article ?? ""));
  if (!articlePlain) return undefined;

  const posPlain = spreadsheetCellToPlainString(String(lookup.position ?? ""));
  const lenMm =
    lookup.lengthMm != null && Number.isFinite(Number(lookup.lengthMm))
      ? Math.round(Number(lookup.lengthMm))
      : null;

  const keysToTry: string[] = [];
  const add = (inp: ItemCodeLookupInput) => {
    const k = normalizeItemCodeLookupKey(inp);
    if (k && !keysToTry.includes(k)) keysToTry.push(k);
  };

  const posOpt = posPlain || undefined;

  add({ article: articlePlain, position: posOpt, lengthMm: lenMm });
  if (posPlain && /^\d+$/.test(posPlain.replace(/\s/g, ""))) {
    add({
      article: articlePlain,
      position: String(parseInt(posPlain.replace(/\s/g, ""), 10)),
      lengthMm: lenMm,
    });
  }
  if (lenMm != null) {
    add({ article: articlePlain, position: undefined, lengthMm: lenMm });
  }
  if (posOpt) {
    add({ article: articlePlain, position: posOpt, lengthMm: null });
    if (/^\d+$/.test(posPlain.replace(/\s/g, ""))) {
      add({
        article: articlePlain,
        position: String(parseInt(posPlain.replace(/\s/g, ""), 10)),
        lengthMm: null,
      });
    }
  }

  const artOnly = normalizeArticleLookupKey(articlePlain);
  if (!keysToTry.includes(artOnly)) keysToTry.push(artOnly);

  for (const k of keysToTry) {
    const v = memory[k]?.trim();
    if (v) return v;
  }

  /**
   * Drugi Excel često nema istu kolonu „Pozicija“ kao prvi: ključ u memoriji je `…|p:1|…`, a uvoz pravi `…|p:-|…`.
   * Ili nema „Dužina“: memorija ima `l:2000`, uvoz `l:-` — tada tražimo po artiklu+poziciji ako je šifra jednoznačna.
   */
  const artKey = artOnly;
  if (!artKey) return undefined;

  if (lenMm != null) {
    const wantL = String(lenMm);
    const hits: string[] = [];
    for (const [k, v] of Object.entries(memory)) {
      const code = v?.trim();
      if (!code) continue;
      const parts = parseCompositeMemoryKey(k);
      if (!parts) continue;
      if (parts.article !== artKey) continue;
      if (parts.length !== wantL) continue;
      hits.push(code);
    }
    const uniq = uniqueNonEmpty(hits);
    if (uniq.length === 1) return uniq[0];
  }

  if (lenMm == null && posPlain.trim()) {
    const hits: string[] = [];
    for (const [k, v] of Object.entries(memory)) {
      const code = v?.trim();
      if (!code) continue;
      const parts = parseCompositeMemoryKey(k);
      if (!parts) continue;
      if (parts.article !== artKey) continue;
      if (!memoryPositionSegmentsMatch(parts.position, posPlain)) continue;
      hits.push(code);
    }
    const uniq = uniqueNonEmpty(hits);
    if (uniq.length === 1) return uniq[0];
  }

  return undefined;
}
