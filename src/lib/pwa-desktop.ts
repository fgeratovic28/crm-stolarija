/** Instalirana PWA ili Electron — desktop klijent (ne običan mobilni tab). */
export function isPwaDesktopClient(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.VITE_ELECTRON_BUILD === "true") return true;

  try {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches;
    if (!standalone) return false;
  } catch {
    return false;
  }

  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) {
    try {
      if (window.matchMedia("(max-width: 900px)").matches) return false;
    } catch {
      /* ignore */
    }
    return true;
  }

  try {
    if (window.matchMedia("(min-width: 1024px)").matches) return true;
    if (window.matchMedia("(pointer: fine)").matches) return true;
  } catch {
    /* ignore */
  }

  return false;
}
