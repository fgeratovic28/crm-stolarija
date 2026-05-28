const STORAGE_KEY = "crm_stolarija_rich_splash_done";

/** Jedan progress splash po punom učitavanju dokumenta (bez duplog login → app). */
let entrySplashShownThisPageLoad = false;

/**
 * Boot ili session splash već prikazan u ovom učitavanju taba (SPA navigacija ne resetuje).
 */
export function hasEntrySplashShownThisPageLoad(): boolean {
  return entrySplashShownThisPageLoad;
}

export function markEntrySplashShownThisPageLoad(): void {
  entrySplashShownThisPageLoad = true;
}

/**
 * Označava da je korisnik video boot splash na /login (progress) do kraja u ovoj kartici.
 * Postavlja se u `LoginPage` kad splash pozove `onReadyVisualComplete` — ne pri svakom refresh-u auth-a.
 */
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
