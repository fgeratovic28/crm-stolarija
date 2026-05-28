import { MATERIAL_TYPE_OPTIONS } from "@/lib/material-type-options";

/**
 * U bazi `suppliers.category` može biti srpski naziv iz šifarnika ili engleski slug
 * isti kao `MaterialType` (npr. "profile") — za UI uvek prikaži čitljiv srpski tekst.
 */
const MATERIAL_SLUG_TO_SUPPLIER_LABEL: Record<string, string> = {
  profile: "Profili",
  glass: "Staklo",
  hardware: "Okov",
  other: "Ostalo",
};

export function labelSupplierCategoryForDisplay(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  const fromLegacy = MATERIAL_SLUG_TO_SUPPLIER_LABEL[lower];
  if (fromLegacy) return fromLegacy;
  const fromMaterial = MATERIAL_TYPE_OPTIONS.find((o) => o.value === lower);
  if (fromMaterial) return fromMaterial.label;
  return s;
}
