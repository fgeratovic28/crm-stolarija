import { useState } from "react";
import { useLocation } from "react-router-dom";
import { AppSessionLoadingScreen } from "@/components/AppSessionLoadingScreen";
import {
  hasEntrySplashShownThisPageLoad,
  hasRichSplashCompleted,
  markEntrySplashShownThisPageLoad,
} from "@/lib/rich-splash-session";
import { useAuthStore } from "@/stores/auth-store";

/** Javne rute koje same rešavaju učitavanje (login boot, gost narudžbenica…). */
const SESSION_GATE_BYPASS_PREFIXES = [
  "/login",
  "/order-reception",
  "/narudzbenica",
  "/r/order",
] as const;

function pathBypassesSessionGate(pathname: string): boolean {
  return SESSION_GATE_BYPASS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

type SessionEntryGateProps = {
  children: React.ReactNode;
};

/**
 * Provera sesije (spinner) samo za prijavljene korisnike pri refresh-u aplikacije.
 * Neprijavljeni idu odmah na rute → /login sa boot progress barom (bez duplog učitavanja).
 */
export function SessionEntryGate({ children }: SessionEntryGateProps) {
  const location = useLocation();
  const { authReady, isAuthenticated, authProfileReady } = useAuthStore();
  const [visualDone, setVisualDone] = useState(() => hasEntrySplashShownThisPageLoad());

  if (pathBypassesSessionGate(location.pathname)) {
    return <>{children}</>;
  }

  // Nema aktivne sesije — preskoči gate (ProtectedRoute šalje na /login, boot splash je tamo).
  if (authReady && !isAuthenticated) {
    return <>{children}</>;
  }

  // Još ne znamo auth stanje: spinner samo ako je u ovoj kartici već bila prijava (refresh),
  // inače pusti rute da ne prikažu „Proveru sesije“ pre /login boot-a.
  if (!authReady) {
    if (hasRichSplashCompleted()) {
      return (
        <AppSessionLoadingScreen sessionReady={false} appearance="spinner" variant="session" />
      );
    }
    return <>{children}</>;
  }

  // authReady && isAuthenticated — čekamo profil pre ulaska u aplikaciju
  const sessionCheckReady = authProfileReady;

  if (!visualDone) {
    return (
      <AppSessionLoadingScreen
        sessionReady={sessionCheckReady}
        appearance="spinner"
        variant="session"
        onReadyVisualComplete={() => {
          markEntrySplashShownThisPageLoad();
          setVisualDone(true);
        }}
      />
    );
  }

  return <>{children}</>;
}
