import { motion } from "framer-motion";
import { Hammer } from "lucide-react";

/**
 * Dok se proverava režim održavanja — ujednačeno sa brendom, bez golog „Učitavanje…”.
 */
export function MaintenanceCheckingScreen() {
  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background px-6"
      aria-busy="true"
      aria-live="polite"
      aria-label="Provera sistema"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] overflow-hidden bg-primary/15">
        <motion.div
          className="h-full w-[38%] rounded-full bg-primary"
          initial={{ x: "-100%" }}
          animate={{ x: "280%" }}
          transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_45%_at_50%_-15%,hsl(var(--primary)/0.1),transparent)]"
        aria-hidden
      />
      <div className="relative z-[1] flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-md shadow-primary/20">
          <Hammer className="h-7 w-7 text-primary-foreground" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Stolarija CRM</p>
          <p className="text-sm text-muted-foreground">Provera veze sa serverom…</p>
        </div>
      </div>
    </div>
  );
}
