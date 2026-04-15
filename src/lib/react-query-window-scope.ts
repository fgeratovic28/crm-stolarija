const STORAGE_KEY = "crm-rq-window-scope";

/**
 * Stabilan ID po browser prozoru/tab-u (sessionStorage je izolovan po kontekstu).
 * Uključuje se u `queryKeyHashFn` tako da keš ostaje odvojen po prozoru bez menjanja
 * `queryKey` nizova — `invalidateQueries` i dalje radi sa istim ključevima.
 */
export function getReactQueryWindowScope(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = sessionStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return "fallback-scope";
  }
}
