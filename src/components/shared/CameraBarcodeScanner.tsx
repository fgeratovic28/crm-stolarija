import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RefreshCw, X } from "lucide-react";

/** Iste konstante kao u config.qrbox — okvir mora da prati tačan px pravougaonik biblioteke. */
const QRBOX_WIDTH_RATIO = 0.85;
const QRBOX_HEIGHT_RATIO = 0.3;

function qrboxFromViewfinder(viewfinderWidth: number, viewfinderHeight: number) {
  const width = Math.floor(viewfinderWidth * QRBOX_WIDTH_RATIO);
  const height = Math.floor(viewfinderHeight * QRBOX_HEIGHT_RATIO);
  return { width, height };
}

function qrboxOverlayRect(viewfinderWidth: number, viewfinderHeight: number) {
  const { width, height } = qrboxFromViewfinder(viewfinderWidth, viewfinderHeight);
  return {
    left: Math.floor((viewfinderWidth - width) / 2),
    top: Math.floor((viewfinderHeight - height) / 2),
    width,
    height,
  };
}

const BACK_CAMERA_LABEL = /back|rear|environment|zadnj|stražn|traseira/i;

function isAndroidClient(): boolean {
  return /Android/i.test(navigator.userAgent);
}

async function pickBackCameraDeviceId(): Promise<string | null> {
  try {
    const cameras = await Html5Qrcode.getCameras();
    const withId = cameras.filter((c) => c.id);
    if (withId.length === 0) return null;

    const labeledBack = withId.find((c) => BACK_CAMERA_LABEL.test(c.label));
    if (labeledBack?.id) return labeledBack.id;

    if (withId.length >= 2) return withId[withId.length - 1].id;
    return withId[0].id;
  } catch {
    return null;
  }
}

async function safeStopScanner(scanner: Html5Qrcode) {
  try {
    if (scanner.isScanning) await scanner.stop();
  } catch {
    /* already stopped */
  }
  try {
    scanner.clear();
  } catch {
    /* ignore */
  }
}

function friendlyCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  const message = String((err as { message?: string })?.message ?? err ?? "");

  if (name === "NotAllowedError" || message.includes("Permission denied")) {
    return "Pristup kameri je odbijen. Dozvolite kameru u podešavanjima pretraživača (ikonica katanca u adresnoj traci).";
  }
  if (name === "NotFoundError" || message.includes("Requested device not found")) {
    return "Kamera nije pronađena na ovom uređaju.";
  }
  if (
    name === "NotReadableError" ||
    name === "OverconstrainedError" ||
    message.includes("Could not start video source")
  ) {
    return "Kamera je zauzeta ili nije podržana konfiguracija. Zatvorite druge aplikacije koje koriste kameru i pokušajte ponovo.";
  }
  return "Nije moguće pristupiti kameri.";
}

interface CameraBarcodeScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (error: string) => void;
  onClose: () => void;
}

export function CameraBarcodeScanner({
  onScanSuccess,
  onScanError,
  onClose,
}: CameraBarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastScannedCodeRef = useRef<string | null>(null);
  const lastScannedTimeRef = useRef<number>(0);
  const regionId = "camera-scanner-region";
  const scanAreaRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<
    "initializing" | "awaiting_tap" | "requesting" | "running" | "error" | "scanned"
  >("initializing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qrOverlayRect, setQrOverlayRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const playBeep = () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // Visok ton (A5)
      gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.1);
    } catch (err) {
      console.warn("Nije moguće pustiti zvuk:", err);
    }
  };

  const startScannerRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!window.isSecureContext) {
      setStatus("error");
      setErrorMessage(
        "Kamera zahteva sigurnu vezu (HTTPS). Proverite da li pristupate aplikaciji preko sigurne adrese.",
      );
      return;
    }

    const html5QrCode = new Html5Qrcode(regionId, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
      ],
      verbose: false,
    });
    scannerRef.current = html5QrCode;

    const scanConfig = {
      fps: 15,
      qrbox: (viewfinderWidth: number, viewfinderHeight: number) =>
        qrboxFromViewfinder(viewfinderWidth, viewfinderHeight),
      disableFlip: false,
    };

    const onDecoded = (decodedText: string) => {
      const now = Date.now();
      if (decodedText === lastScannedCodeRef.current && now - lastScannedTimeRef.current < 2000) {
        return;
      }
      lastScannedCodeRef.current = decodedText;
      lastScannedTimeRef.current = now;
      playBeep();
      setStatus("scanned");
      setTimeout(() => {
        setStatus("running");
        onScanSuccess(decodedText);
      }, 500);
    };

    const startScanner = async () => {
      setStatus("requesting");
      setErrorMessage(null);

      const backDeviceId = await pickBackCameraDeviceId();
      const cameraAttempts: Array<string | { facingMode: "environment" | "user" }> = [];
      if (backDeviceId) cameraAttempts.push(backDeviceId);
      cameraAttempts.push({ facingMode: "environment" }, { facingMode: "user" });

      let lastErr: unknown = null;
      for (const camera of cameraAttempts) {
        try {
          await safeStopScanner(html5QrCode);
          await html5QrCode.start(camera, scanConfig, onDecoded, () => {});
          setStatus("running");
          return;
        } catch (err) {
          lastErr = err;
          console.warn("Pokušaj kamere nije uspeo:", camera, err);
        }
      }

      console.error("Greška pri pokretanju kamere:", lastErr);
      const userFriendlyMsg = friendlyCameraError(lastErr);
      setStatus("error");
      setErrorMessage(userFriendlyMsg);
      onScanError?.(userFriendlyMsg);
    };

    startScannerRef.current = startScanner;

    if (isAndroidClient()) {
      setStatus("awaiting_tap");
    } else {
      void startScanner();
    }

    return () => {
      startScannerRef.current = null;
      void safeStopScanner(html5QrCode);
    };
  }, [onScanSuccess, onScanError]);

  useLayoutEffect(() => {
    if (status !== "running") {
      setQrOverlayRect(null);
      return;
    }

    const el = scanAreaRef.current;
    if (!el) return;

    let rafAttempt = 0;
    const maxRafAttempts = 90;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 2 || h < 2) {
        if (rafAttempt < maxRafAttempts) {
          rafAttempt += 1;
          requestAnimationFrame(measure);
        }
        return;
      }
      setQrOverlayRect(qrboxOverlayRect(w, h));
    };

    measure();
    requestAnimationFrame(measure);

    const ro = new ResizeObserver(() => {
      rafAttempt = 0;
      measure();
    });
    ro.observe(el);

    const onOrientation = () => {
      rafAttempt = 0;
      requestAnimationFrame(measure);
    };
    window.addEventListener("orientationchange", onOrientation);

    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", onOrientation);
      vv?.removeEventListener("resize", measure);
    };
  }, [status]);

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-zinc-950 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-title"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(25_50%_12%)_0%,transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(24,24,27,1)_0%,rgba(9,9,11,1)_100%)]" />

      {/* Header */}
      <div className="relative z-[102] shrink-0 flex items-center justify-between gap-4 px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3 sm:px-6">
        <div className="min-w-0">
          <p id="scanner-title" className="text-sm font-semibold tracking-tight text-white">
            Skeniranje bar koda
          </p>
          <p className="text-[11px] text-zinc-500 truncate sm:text-xs">
            Poravnajte linije koda okomito u pravougaoniku · zadnja kamera
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-full border border-white/10 bg-black/35 text-white hover:bg-black/55 hover:border-white/20"
          onClick={onClose}
        >
          <X className="h-5 w-5" aria-hidden />
          <span className="sr-only">Zatvori skener</span>
        </Button>
      </div>

      <div className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center">
        {/* Isti px prostor kao viewfinder u html5-qrcode (ResizeObserver + explicit rect radi iOS/Safari) */}
        <div
          ref={scanAreaRef}
          className="absolute inset-0 min-h-0 w-full overflow-hidden"
        >
          <div
            id={regionId}
            className="absolute inset-0 h-full w-full min-h-0 [&>video]:h-full [&>video]:w-full [&>video]:object-cover [&>canvas]:hidden after:pointer-events-none after:absolute after:inset-0 after:bg-gradient-to-t after:from-zinc-950/90 after:via-transparent after:to-zinc-950/40"
          />
        </div>

        {/* Flash efekat na uspešan sken */}
        {status === "scanned" && (
          <div className="absolute inset-0 z-[110] flex animate-in items-center justify-center bg-emerald-500/[0.18] fade-in duration-150 zoom-in-95">
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-zinc-900/95 px-8 py-6 shadow-xl shadow-black/60 ring-1 ring-emerald-500/35">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 shadow-[0_0_28px_-4px_theme(colors.emerald.500)]">
                <CheckCircle2 className="h-10 w-10" aria-hidden strokeWidth={1.65} />
              </div>
              <p className="text-sm font-medium text-white">Kod primljen</p>
            </div>
          </div>
        )}

        {/* Loading / Error overlay */}
        {status !== "running" && status !== "scanned" && (
          <div className="absolute inset-0 z-[50] flex items-center justify-center p-4">
            <div className="flex w-full max-w-md flex-col items-center justify-center rounded-2xl border border-white/[0.08] bg-zinc-900/92 px-5 py-7 text-center shadow-2xl shadow-black/70 backdrop-blur-md">
            {status === "awaiting_tap" ? (
              <>
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-primary/35 bg-primary/15">
                  <RefreshCw className="h-7 w-7 text-primary" aria-hidden />
                </div>
                <p className="mb-1.5 text-base font-semibold text-white">Pokrenite kameru</p>
                <p className="mb-6 text-sm leading-relaxed text-zinc-400">
                  Na Androidu morate dodirnuti dugme ispod da bi pretraživač dozvolio pristup kameri.
                </p>
                <Button
                  type="button"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => void startScannerRef.current?.()}
                >
                  Pokreni kameru
                </Button>
              </>
            ) : status === "initializing" || status === "requesting" ? (
              <>
                <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
                  <div className="absolute inset-0 animate-pulse rounded-full border-[3px] border-primary/25" />
                  <div className="absolute inset-[3px] rounded-full border border-primary/40" />
                  <RefreshCw className="relative h-7 w-7 text-primary" aria-hidden animate-spin />
                </div>
                <p className="mb-1.5 text-base font-semibold text-white">Učitavanje kamere…</p>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Prihvatite pristup kameri u pretraživaču ako se pojavi zahtev.
                </p>
              </>
            ) : status === "error" ? (
              <>
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/35 bg-red-500/15">
                  <X className="h-8 w-8 text-red-400" aria-hidden />
                </div>
                <p className="mb-2 text-base font-semibold text-white">Kamera nedostupna</p>
                <p className="mb-6 max-w-[280px] text-sm leading-relaxed text-zinc-400">{errorMessage}</p>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                  <Button
                    variant="outline"
                    className="w-full border-white/15 bg-transparent text-white hover:bg-white/10 sm:w-auto"
                    onClick={() => {
                      setErrorMessage(null);
                      void startScannerRef.current?.();
                    }}
                  >
                    Pokušaj ponovo
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-white/15 bg-transparent text-white hover:bg-white/10 sm:w-auto"
                    onClick={() => window.location.reload()}
                  >
                    Osveži stranu
                  </Button>
                  <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-auto" onClick={onClose}>
                    Zatvori
                  </Button>
                </div>
              </>
            ) : null}
            </div>
          </div>
        )}

        {/* Nišan: px rect izračunat kao html5-qrcode qrbox (ne oslanjati se na % height na mobilnom) */}
        {status === "running" && qrOverlayRect && qrOverlayRect.width > 0 && (
          <>
            <div
              className="pointer-events-none absolute z-20 overflow-hidden rounded-xl border border-white/15 bg-black/20 shadow-[inset_0_0_32px_rgba(0,0,0,0.35)]"
              style={{
                left: qrOverlayRect.left,
                top: qrOverlayRect.top,
                width: qrOverlayRect.width,
                height: qrOverlayRect.height,
              }}
            >
              <span className="absolute left-2 top-2 h-6 w-6 rounded-tl-lg border-[3px] border-l-[hsl(var(--primary))] border-t-[hsl(var(--primary))]" />
              <span className="absolute right-2 top-2 h-6 w-6 rounded-tr-lg border-[3px] border-r-[hsl(var(--primary))] border-t-[hsl(var(--primary))]" />
              <span className="absolute bottom-2 left-2 h-6 w-6 rounded-bl-lg border-[3px] border-b-[hsl(var(--primary))] border-l-[hsl(var(--primary))]" />
              <span className="absolute bottom-2 right-2 h-6 w-6 rounded-br-lg border-[3px] border-b-[hsl(var(--primary))] border-r-[hsl(var(--primary))]" />
              <div className="pointer-events-none absolute inset-x-3 inset-y-1 overflow-hidden rounded-md">
                <div className="animate-scan-line absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/95 to-transparent shadow-[0_0_14px_-1px_hsl(var(--primary))]" />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),5.5rem)] z-20 mx-auto max-w-sm px-4">
              <div className="rounded-xl border border-white/[0.08] bg-black/55 px-4 py-3 text-center shadow-lg backdrop-blur-md">
                <p className="text-sm font-medium text-white">Postavite bar kod u okvir</p>
                <p className="mt-1 text-[11px] leading-snug text-zinc-400 sm:text-xs">
                  Držite telefon mirno; približite ili udaljite dok linije ne budu oštre.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
