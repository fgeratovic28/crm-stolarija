/** Spaja patch u base tako da `undefined` vrednosti ne brišu postojeća polja. */
export function mergeDefined<T extends object>(base: T, patch: Record<string, unknown>): T {
  const o = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) o[k] = v;
  }
  return o as T;
}
