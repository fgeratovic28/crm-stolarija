const STORAGE_KEY = "crm_stolarija_rich_splash_done";

/** Bogati splash samo pri prvom učitavanju u ovoj kartici; posle refresh-a koristi se kraći fallback. */
export function hasRichSplashCompleted(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markRichSplashCompleted(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
}
