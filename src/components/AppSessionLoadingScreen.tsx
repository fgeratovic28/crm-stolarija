import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hammer } from "lucide-react";
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

type AppSessionLoadingScreenProps = {
  /** Kada je prvi getSession / inicijalizacija auth-a završena. */
  sessionReady: boolean;
  /**
   * Ako je prosleđeno (npr. login), poziva se nakon što je progress stigao do 100% i kratke pauze.
   * Bez ovoga komponenta služi samo kao „čekanje“ dok roditelj ne ukloni (npr. ProtectedRoute).
   */
  onReadyVisualComplete?: () => void;
};

export function AppSessionLoadingScreen({
  sessionReady,
  onReadyVisualComplete,
}: AppSessionLoadingScreenProps) {
  const [progress, setProgress] = useState(4);
  const [messageIndex, setMessageIndex] = useState(0);
  const startedAt = useRef<number>(Date.now());
  const completionSent = useRef(false);
  const progressRef = useRef(4);

  const waitForFinishAnimation = Boolean(onReadyVisualComplete);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const minElapsed = Date.now() - startedAt.current >= MIN_VISIBLE_MS;
      const p = progressRef.current;

      const cap =
        waitForFinishAnimation && sessionReady && minElapsed
          ? 100
          : 92;

      let next = p;
      if (p < cap - 0.08) {
        next = Math.min(cap, p + (cap - p) * 0.055 + Math.random() * 0.28);
      } else {
        next = cap;
      }

      progressRef.current = next;
      setProgress(next);

      if (
        waitForFinishAnimation &&
        onReadyVisualComplete &&
        sessionReady &&
        minElapsed &&
        next >= 99.85 &&
        !completionSent.current
      ) {
        completionSent.current = true;
        window.setTimeout(() => {
          onReadyVisualComplete();
        }, FINISH_HOLD_MS);
      }
    }, 48);

    return () => window.clearInterval(id);
  }, [sessionReady, waitForFinishAnimation, onReadyVisualComplete]);

  const pct = Math.round(Math.min(100, Math.max(0, progress)));

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
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-md shadow-primary/25"
              animate={{ scale: [1, 1.03, 1] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            >
              <Hammer className="h-8 w-8 text-primary-foreground" aria-hidden />
            </motion.div>

            <h1 className="text-lg font-semibold tracking-tight text-foreground">Stolarija CRM</h1>
            <p className="mt-1 text-sm text-muted-foreground">Pokretanje aplikacije</p>

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
              <p className="text-[11px] leading-relaxed text-muted-foreground/90">
                Molimo sačekajte — ovo se dešava samo pri prvom učitavanju ili osvežavanju stranice.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
