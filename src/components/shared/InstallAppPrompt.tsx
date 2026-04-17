import { useCallback, useEffect, useState } from "react";
import { Download, Share2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Chromium `beforeinstallprompt` (nije u svim TS lib setovima). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_DISMISS = "crm-pwa-install-dismissed-at";
const STORAGE_INSTALLED = "crm-pwa-installed-marker";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_IOS_MS = 900;
const SHOW_DELAY_ANDROID_FALLBACK_MS = 2800;

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return true;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* ignore */
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isLikelyPhone(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.matchMedia("(max-width: 900px)").matches) return false;
  const touch = "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  return touch;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
}

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function InstallAppPrompt() {
  const isElectronApp = import.meta.env.VITE_ELECTRON_BUILD === "true";
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const dismissedRecently = useCallback((): boolean => {
    try {
      const raw = localStorage.getItem(STORAGE_DISMISS);
      if (!raw) return false;
      const t = Number(raw);
      if (!Number.isFinite(t)) return false;
      return Date.now() - t < DISMISS_MS;
    } catch {
      return false;
    }
  }, []);

  const wasMarkedInstalled = useCallback((): boolean => {
    try {
      return localStorage.getItem(STORAGE_INSTALLED) === "1";
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (isElectronApp) {
      return;
    }
    if (!isLikelyPhone() || isStandaloneDisplay()) {
      setVisible(false);
      return;
    }
    if (wasMarkedInstalled() || dismissedRecently()) {
      setVisible(false);
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onAppInstalled = () => {
      try {
        localStorage.setItem(STORAGE_INSTALLED, "1");
      } catch {
        /* ignore */
      }
      setDeferredPrompt(null);
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    const showAfterDelay = () => {
      if (isStandaloneDisplay()) return;
      if (wasMarkedInstalled() || dismissedRecently()) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      setVisible(true);
    };

    const delayMs = isIOS() ? SHOW_DELAY_IOS_MS : SHOW_DELAY_ANDROID_FALLBACK_MS;
    const timer = window.setTimeout(showAfterDelay, delayMs);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.clearTimeout(timer);
    };
  }, [dismissedRecently, wasMarkedInstalled, isElectronApp]);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_DISMISS, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
    setDeferredPrompt(null);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* ignore */
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isElectronApp) return null;
  if (!visible) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  const canUseChromiumInstall = Boolean(deferredPrompt && isAndroid());

  return (
    <div
      className={cn(
        "fixed z-40 animate-in fade-in slide-in-from-bottom-4 duration-300",
        "left-4 right-4 bottom-[max(1rem,env(safe-area-inset-bottom))]",
        "sm:left-auto sm:right-4 sm:max-w-md",
      )}
    >
      <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {isIOS() ? <Share2 className="h-5 w-5" aria-hidden /> : <Smartphone className="h-5 w-5" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Dodaj aplikaciju na početni ekran</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Brži pristup i bolje iskustvo kao na običnoj aplikaciji.
              </p>
            </div>

            {isIOS() && (
              <ol className="list-decimal space-y-2 pl-4 text-xs text-foreground">
                <li>
                  Dodirnite dugme <strong>Deljenje</strong>{" "}
                  <span className="whitespace-nowrap text-muted-foreground">(kvadrat sa strelicom na gore)</span> na dnu
                  ekrana.
                </li>
                <li>
                  Skrolujte i izaberite <strong>Dodaj na početni ekran</strong>{" "}
                  <span className="text-muted-foreground">(Add to Home Screen)</span>.
                </li>
                <li>
                  Potvrdite sa <strong>Dodaj</strong> u gornjem desnom uglu.
                </li>
              </ol>
            )}

            {isAndroid() && canUseChromiumInstall && (
              <Button type="button" className="w-full gap-2" onClick={() => void handleInstallClick()}>
                <Download className="h-4 w-4" aria-hidden />
                Instaliraj aplikaciju
              </Button>
            )}

            {isAndroid() && !canUseChromiumInstall && (
              <p className="text-xs text-muted-foreground">
                U Chrome meniju <span className="font-medium text-foreground">⋮</span> izaberite{" "}
                <strong>Instaliraj aplikaciju</strong> ili <strong>Dodaj na početni ekran</strong>. Na nekim uređajima
                opcija se pojavi tek kada sajt posetiš nekoliko puta.
              </p>
            )}

            {!isIOS() && !isAndroid() && (
              <p className="text-xs text-muted-foreground">
                Koristi opciju pregledača za dodavanje na početni ekran / instalaciju aplikacije.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={handleDismiss}>
                Kasnije
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="-m-1 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Zatvori"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
