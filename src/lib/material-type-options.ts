import type { MaterialType, Supplier } from "@/types";

export const MATERIAL_TYPE_OPTIONS: { value: MaterialType; label: string }[] = [
  { value: "glass", label: "Staklo" },
  { value: "profile", label: "Profil" },
  { value: "hardware", label: "Okov" },
  { value: "shutters", label: "Roletne" },
  { value: "mosquito_net", label: "Komarnici" },
  { value: "sills", label: "Podprozorske daske" },
  { value: "boards", label: "Opšivke" },
  { value: "sealant", label: "Zaptivni materijal" },
  { value: "other", label: "Ostalo" },
];

/** Vrste materijala za stavke: ako dobavljač ima listu u šifarniku, samo te; inače sve. */
export function lineMaterialOptionsForSupplier(
  supplier: Pick<Supplier, "materialTypes"> | null | undefined,
): { value: MaterialType; label: string }[] {
  const types = supplier?.materialTypes?.filter(Boolean) as MaterialType[] | undefined;
  if (!types?.length) return MATERIAL_TYPE_OPTIONS;
  const filtered = MATERIAL_TYPE_OPTIONS.filter((o) => types.includes(o.value));
  return filtered.length > 0 ? filtered : MATERIAL_TYPE_OPTIONS;
}
