import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { TermoPlastCrmTitle } from "@/components/shared/TermoPlastCrmTitle";
import { Progress } from "@/components/ui/progress";

const STATUS_MESSAGES = [
  "Povezivanje sa serverom…",
  "Učitavanje podešavanja…",
  "Provera sigurnosne sesije…",
  "Sinhronizacija podataka…",
  "Priprema interfejsa…",
] as const;

const MIN_VISIBLE_MS = 720;
const FINISH_HOLD_MS = 380;
/** Dok nema `authReady`, progress raste po vremenu do ovog plafona (stvarni kraj je kad stigne sesija). */
const PROGRESS_CAP_BEFORE_SESSION = 88;
const TIME_FILL_TO_CAP_MS = 5200;

type LoadingVariant = "boot" | "session";

const VARIANT_COPY: Record<
  LoadingVariant,
  { subtitle: string; footer: string }
> = {
  boot: {
    subtitle: "Pokretanje aplikacije",
    footer:
      "Napredak prati učitavanje sesije sa servera. Ovaj ekran se prikazuje samo pri prvom otvaranju prijave u ovoj kartici.",
  },
  session: {
    subtitle: "Provera sesije",
    footer: "Učitavanje naloga i provera prijave pre nastavka rada.",
  },
};

type AppSessionLoadingScreenProps = {
  /** Kada je prvi getSession / inicijalizacija auth-a završena (stvarni mrežni korak). */
  sessionReady: boolean;
  /** Nakon 100% + kratke pauze (progress režim). */
  onReadyVisualComplete?: () => void;
  /** `progress` — ulazak na stranicu / boot; `spinner` — rezervni jednostavan ekran. */
  appearance?: "progress" | "spinner";
  variant?: LoadingVariant;
};

function messageIndexForProgress(pct: number, sessionReady: boolean): number {
  if (sessionReady && pct >= 95) return STATUS_MESSAGES.length - 1;
  const n = STATUS_MESSAGES.length;
  return Math.min(n - 2, Math.max(0, Math.floor((pct / PROGRESS_CAP_BEFORE_SESSION) * (n - 1))));
}

export function AppSessionLoadingScreen({
  sessionReady,
  onReadyVisualComplete,
  appearance = "progress",
  variant = "boot",
}: AppSessionLoadingScreenProps) {
  const [progress, setProgress] = useState(4);
  const [messageIndex, setMessageIndex] = useState(0);
  const startedAt = useRef<number>(Date.now());
  const completionSent = useRef(false);
  const progressRef = useRef(4);

  const isProgressSplash = appearance === "progress";
  const copy = VARIANT_COPY[variant];

  useEffect(() => {
    if (isProgressSplash || !onReadyVisualComplete) return;
    if (!sessionReady || completionSent.current) return;

    completionSent.current = true;
    onReadyVisualComplete();
  }, [sessionReady, onReadyVisualComplete, isProgressSplash]);

  useEffect(() => {
    if (!isProgressSplash) return;

    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const minElapsed = elapsed >= MIN_VISIBLE_MS;
      let p = progressRef.current;

      if (sessionReady) {
        // Stvarni signal: sesija je rešena — od trenutnog % do 100%
        p = Math.min(100, p + Math.max(0.85, (100 - p) * 0.12));
      } else {
        // Još čekamo getSession: deterministički rast po vremenu, plafon do stvarnog `sessionReady`
        const t = Math.min(1, elapsed / TIME_FILL_TO_CAP_MS);
        const eased = 1 - (1 - t) * (1 - t);
        const target = 4 + eased * (PROGRESS_CAP_BEFORE_SESSION - 4);
        p = Math.min(PROGRESS_CAP_BEFORE_SESSION, Math.max(p, target));
      }

      progressRef.current = p;
      setProgress(p);
      setMessageIndex(messageIndexForProgress(p, sessionReady));

      if (
        onReadyVisualComplete &&
        sessionReady &&
        minElapsed &&
        p >= 99.85 &&
        !completionSent.current
      ) {
        completionSent.current = true;
        window.setTimeout(() => {
          onReadyVisualComplete();
        }, FINISH_HOLD_MS);
      }
    }, 48);

    return () => window.clearInterval(id);
  }, [sessionReady, onReadyVisualComplete, isProgressSplash]);

  const pct = Math.round(Math.min(100, Math.max(0, progress)));

  if (appearance === "spinner" || !isProgressSplash) {
    return (
      <div
        className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background p-6"
        aria-busy="true"
        aria-live="polite"
        aria-label={variant === "session" ? "Provera sesije" : "Učitavanje"}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.35)_1px,transparent_1px)] [background-size:48px_48px]"
          aria-hidden
        />

        <motion.div
          className="relative z-10 w-full max-w-md"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="rounded-2xl border border-border/80 bg-card/80 p-10 shadow-lg shadow-black/5 backdrop-blur-md dark:shadow-black/30">
            <div className="flex flex-col items-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-md ring-1 ring-border/80 dark:bg-white dark:ring-white/20">
                <img
                  src="/logo.png"
                  alt=""
                  className="h-10 w-auto max-w-[3.5rem] object-contain"
                  width={120}
                  height={40}
                  decoding="async"
                />
              </div>
              <h1 className="text-lg tracking-tight">
                <TermoPlastCrmTitle />
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>
              <Loader2 className="mt-6 h-8 w-8 animate-spin text-primary" aria-hidden />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background p-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Učitavanje aplikacije"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.35)_1px,transparent_1px)] [background-size:48px_48px]"
        aria-hidden
      />

      <motion.div
        className="relative z-10 w-full max-w-md"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="rounded-2xl border border-border/80 bg-card/80 p-8 shadow-lg shadow-black/5 backdrop-blur-md dark:shadow-black/30">
          <div className="flex flex-col items-center text-center">
            <motion.div
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-md shadow-black/10 ring-1 ring-border/80 dark:bg-white dark:shadow-black/30 dark:ring-white/20"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <img
                src="/logo.png"
                alt=""
                className="h-10 w-auto max-w-[3.5rem] object-contain"
                width={120}
                height={40}
                decoding="async"
              />
            </motion.div>

            <h1 className="text-lg tracking-tight">
              <TermoPlastCrmTitle />
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>

            <div className="mt-8 w-full space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={messageIndex}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="min-h-[1rem] text-left"
                  >
                    {STATUS_MESSAGES[messageIndex]}
                  </motion.span>
                </AnimatePresence>
                <span className="tabular-nums text-foreground/80">{pct}%</span>
              </div>
              <Progress value={progress} className="h-2.5 bg-secondary/80" />
              <p className="text-[11px] leading-relaxed text-muted-foreground/90">{copy.footer}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
