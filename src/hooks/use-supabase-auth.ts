import { useCallback, useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { authStorageKey, persistAuthSession, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { roleHasAppAccess } from "@/config/permissions";
import { AppUser, UserRole } from "@/types";

/** Koliko čekati getSession pre drugog pokušaja / predaje (bez refreshSession petlje). */
const SESSION_RESOLVE_MS = 12_000;
/** Profil iz DB ne sme blokirati authReady niti UI beskonačno. */
const PROFILE_FETCH_MS = 10_000;
/** Debounce za evente (focus/visibility/online) da izbegnemo duple getSession pozive. */
const SESSION_RECHECK_DEBOUNCE_MS = 1_500;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  try {
    const result = await Promise.race([promise, sleep(ms).then(() => null as T | null)]);
    return result === undefined ? null : (result as T | null);
  } catch (e) {
    console.warn("Auth operation rejected (timeout race):", e);
    return null;
  }
}

const KNOWN_ROLES: readonly UserRole[] = [
  "admin",
  "office",
  "finance",
  "procurement",
  "production",
  "montaza",
  "teren",
];

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function coerceMetadataRole(value: unknown): UserRole {
  const normalized = normalizeRole(value);
  if (normalized && (KNOWN_ROLES as readonly string[]).includes(normalized)) {
    return normalized as UserRole;
  }
  return "office";
}

async function getSessionResilient() {
  try {
    return await supabase.auth.getSession();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Lock") || msg.includes("NavigatorLockAcquireTimeoutError")) {
      await sleep(200);
      return await supabase.auth.getSession();
    }
    throw e;
  }
}

/** getSession() sa timeout-om i jednim ponovnim pokušajem — izbegava beskonačan loading posle refresh-a. */
async function getSessionForHydrate(): Promise<{
  data: { session: Session | null };
  error: Error | null;
  timedOut: boolean;
}> {
  const run = () => getSessionResilient();
  let pack = await raceWithTimeout(run(), SESSION_RESOLVE_MS);
  if (!pack) {
    await sleep(250);
    pack = await raceWithTimeout(run(), SESSION_RESOLVE_MS);
  }
  if (!pack) {
    console.error("Auth getSession timed out after retries");
    return { data: { session: null }, error: null, timedOut: true };
  }
  const { data, error } = pack;
  return {
    data: { session: data.session },
    error: error as Error | null,
    timedOut: false,
  };
}

function appUserFromSessionFallback(session: Session): AppUser {
  const u = session.user;
  const meta = u.user_metadata as Record<string, unknown> | undefined;
  const nameFromMeta = typeof meta?.name === "string" ? meta.name.trim() : "";
  const name =
    nameFromMeta ||
    (typeof u.email === "string" && u.email.includes("@") ? u.email.split("@")[0] : "") ||
    "Korisnik";
  const role: UserRole = coerceMetadataRole(meta?.role);
  const teamId =
    typeof meta?.team_id === "string"
      ? meta.team_id
      : typeof meta?.teamId === "string"
        ? meta.teamId
        : undefined;

  return {
    id: u.id,
    email: u.email ?? "",
    name,
    role,
    active: true,
    teamId,
  };
}

export function useSupabaseAuth() {
  const { setUser, mergeUser, setAuthReady, setPendingApproval } = useAuthStore();
  const sessionEffectIdRef = useRef(0);
  const lastSessionRecheckAtRef = useRef(0);
  const sessionRecheckInFlightRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string, fallbackRole: UserRole) => {
    try {
      const raced = await raceWithTimeout(
        (async () =>
          supabase.from("users").select("*").eq("id", userId).single())(),
        PROFILE_FETCH_MS,
      );
      if (raced === null) {
        console.warn("User profile fetch timed out; keeping JWT-derived user if set");
        return null;
      }
      const { data, error } = raced;

      if (error) {
        console.error("Error fetching user profile:", error);
        return null;
      }
      if (!data) return null;
      const dbRole = normalizeRole(data.role);
      const hasAssignedAppRole =
        dbRole !== null &&
        (KNOWN_ROLES as readonly string[]).includes(dbRole) &&
        roleHasAppAccess(dbRole);

      return {
        user: {
          id: data.id,
          email: data.email,
          name: data.name,
          role: hasAssignedAppRole ? (dbRole as UserRole) : fallbackRole,
          active: true,
          teamId: data.team_id,
        } as AppUser,
        pendingApproval: !hasAssignedAppRole,
      };
    } catch (err) {
      console.error("Unexpected error fetching profile:", err);
      return null;
    }
  }, []);

  /**
   * Odmah postavi korisnika iz JWT-a (radi redirect / ProtectedRoute), pa nadogradi iz tabele `users`.
   * Sprečava „zaglavljenu" prijavu dok fetch profila traje ili ako paralelno getSession kasni.
   *
   * Za istog korisnika (ponovljen INITIAL_SESSION / SIGNED_IN) ne prepisuj ulogu JWT-om — u JWT-u
   * `user_metadata.role` često zaostaje za tabelom `users`, pa bi admin privremeno postao npr. office.
   */
  const applySessionToStore = useCallback(async (session: Session | null, isActive: () => boolean) => {
    try {
      if (!session?.user) {
        if (isActive()) {
          setPendingApproval(false);
          setUser(null);
        }
        return;
      }
      const existing = useAuthStore.getState().user;
      const sameUser = existing?.id === session.user.id;
      const fallbackUser = appUserFromSessionFallback(session);
      if (!sameUser) {
        if (isActive()) {
          setPendingApproval(false);
          setUser(fallbackUser);
        }
      }
      const profile = await fetchProfile(session.user.id, sameUser ? existing.role : fallbackUser.role);
      if (!isActive()) return;
      if (profile) {
        setPendingApproval(profile.pendingApproval);
        setUser(profile.user);
      } else {
        // Profil trenutno nije dostupan (RLS/mreža/timeout) — ne zaključavaj validne postojeće naloge.
        setPendingApproval(false);
      }
    } catch (e) {
      console.error("applySessionToStore failed:", e);
      if (!isActive() || !session?.user) return;
      try {
        if (!useAuthStore.getState().user) {
          const fallback = appUserFromSessionFallback(session);
          setPendingApproval(!roleHasAppAccess(fallback.role));
          setUser(fallback);
        }
      } catch {
        /* ignore */
      }
    }
  }, [fetchProfile, setUser]);

  /** Sinhrono postavi JWT korisnika pa u pozadini dovuci profil — authReady ne čeka mrežu. */
  const applySessionFastThenProfile = useCallback((session: Session | null, isActive: () => boolean) => {
    if (!session?.user) {
      if (isActive()) {
        setPendingApproval(false);
        setUser(null);
      }
      return;
    }
    const existing = useAuthStore.getState().user;
    const sameUser = existing?.id === session.user.id;
    const fallbackUser = appUserFromSessionFallback(session);
    if (!sameUser) {
      if (isActive()) {
        setPendingApproval(false);
        setUser(fallbackUser);
      }
    }
    void (async () => {
      try {
        const profile = await fetchProfile(session.user.id, sameUser ? existing.role : fallbackUser.role);
        if (!isActive()) return;
        if (profile) {
          setPendingApproval(profile.pendingApproval);
          setUser(profile.user);
        } else {
          // Profil trenutno nije dostupan (RLS/mreža/timeout) — ne zaključavaj validne postojeće naloge.
          setPendingApproval(false);
        }
      } catch (e) {
        console.error("Background profile fetch failed:", e);
      }
    })();
  }, [fetchProfile, setUser]);

  const revalidateAuthState = useCallback(
    async (isActive: () => boolean, source: string) => {
      if (!isActive()) return;
      if (sessionRecheckInFlightRef.current) return;

      sessionRecheckInFlightRef.current = true;
      try {
        const { data: { session }, error } = await getSessionResilient();
        if (!isActive()) return;
        if (error) {
          console.error(`Auth getSession on ${source}:`, error);
          return;
        }

        let activeSession = session;
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = activeSession?.expires_at ?? null;
        const shouldRefresh = !!activeSession?.refresh_token && typeof expiresAt === "number" && expiresAt <= nowSec + 45;

        if (shouldRefresh) {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (!isActive()) return;
          if (refreshError) {
            const msg = refreshError.message?.toLowerCase() ?? "";
            const invalidRefreshToken = msg.includes("refresh token") || msg.includes("invalid") || msg.includes("expired");
            if (invalidRefreshToken) {
              setPendingApproval(false);
              setUser(null);
              await supabase.auth.signOut();
              return;
            }
            console.error(`Auth refreshSession on ${source}:`, refreshError);
          } else {
            activeSession = refreshed.session ?? activeSession;
          }
        }

        await applySessionToStore(activeSession, isActive);
      } catch (err) {
        console.error(`Auth revalidation error on ${source}:`, err);
      } finally {
        sessionRecheckInFlightRef.current = false;
      }
    },
    [applySessionToStore, setPendingApproval, setUser],
  );

  useEffect(() => {
    const effectId = ++sessionEffectIdRef.current;
    const isActive = () => effectId === sessionEffectIdRef.current;

    setAuthReady(false);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        try {
          if (event === "INITIAL_SESSION") {
            if (session?.user && isActive()) {
              await applySessionToStore(session, isActive);
            }
            // Namerno bez setUser(null) ovde — prazan INITIAL_SESSION ne sme da poništi uspešan getSession.
            return;
          }

          if (event === "SIGNED_IN") {
            if (session?.user && isActive()) {
              await applySessionToStore(session, isActive);
            }
            return;
          }

          if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
            if (session?.user && isActive()) {
              const fallbackRole = useAuthStore.getState().user?.role ?? appUserFromSessionFallback(session).role;
              const appUser = await fetchProfile(session.user.id, fallbackRole);
              if (!isActive()) return;
              if (appUser) {
                setPendingApproval(appUser.pendingApproval);
                mergeUser({
                  email: appUser.user.email,
                  name: appUser.user.name,
                  role: appUser.user.role,
                  teamId: appUser.user.teamId,
                  active: appUser.user.active,
                });
              }
            }
            return;
          }

          if (event === "SIGNED_OUT") {
            // signOut() pre signInWithPassword emituje SIGNED_OUT; ako handler kasni posle SIGNED_IN,
            // naivno setUser(null) briše upravo ulogovanog korisnika. Čistimo store samo ako stvarno nema sesije.
            if (!isActive()) return;
            try {
              const { data: { session: s } } = await getSessionResilient();
              if (!isActive()) return;
              if (!s?.user) {
                setPendingApproval(false);
                setUser(null);
              }
            } catch {
              if (isActive()) {
                setPendingApproval(false);
                setUser(null);
              }
            }
          }
        } catch (err) {
          console.error("Error in onAuthStateChange handler:", err);
        }
      }
    );

    // Posle refresh-a samo INITIAL_SESSION ponekad stigne sa session=null (greška/lock) i obrise store
    // pre nego što stvarna sesija stigne — zato uvek hidriramo i preko getSession.
    void (async () => {
      try {
        const { data: { session }, error, timedOut } = await getSessionForHydrate();
        if (!isActive()) return;
        if (error) {
          console.error("Auth getSession on mount:", error);
          if (isActive()) {
            setPendingApproval(false);
            setUser(null);
          }
          return;
        }
        if (timedOut) {
          console.warn("Auth hydrate: getSession timed out; cleared user so UI can proceed");
        }
        if (session?.user) {
          try {
            applySessionFastThenProfile(session, isActive);
          } catch (e) {
            console.error("Auth hydrate applySessionFastThenProfile:", e);
            if (isActive()) {
              try {
                setUser(appUserFromSessionFallback(session));
              } catch {
                if (isActive()) setUser(null);
              }
            }
          }
        } else if (isActive()) {
          setPendingApproval(false);
          setUser(null);
        }
      } catch (e) {
        console.error("Auth hydrate error:", e);
        if (isActive()) {
          setPendingApproval(false);
          setUser(null);
        }
      } finally {
        if (isActive()) setAuthReady(true);
      }
    })();

    // Samo kad je sesija u localStorage (PWA standalone): drugi tab/prozor menja storage; u običnom tabu auth je in-memory.
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key !== authStorageKey) return;
      void (async () => {
        if (!isActive()) return;
        try {
          const { data: { session }, error } = await getSessionResilient();
          if (!isActive()) return;
          if (error) {
            console.error("Auth getSession on storage sync:", error);
            return;
          }
          await applySessionToStore(session, isActive);
        } catch (err) {
          console.error("Auth storage sync error:", err);
        }
      })();
    };
    if (persistAuthSession) {
      window.addEventListener("storage", onStorage);
    }

    // Kada se tab/prozor vrati iz mirovanja, ručno pokreni session re-check.
    // Ovo sprečava stanje gde posle duže neaktivnosti prvi ekran/zahtevi "zaglave"
    // dok ručni refresh ne natera getSession + token refresh.
    const recheckSession = () => {
      const now = Date.now();
      if (now - lastSessionRecheckAtRef.current < SESSION_RECHECK_DEBOUNCE_MS) return;
      lastSessionRecheckAtRef.current = now;
      void revalidateAuthState(isActive, "resume/focus");
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recheckSession();
      }
    };
    const onWindowFocus = () => recheckSession();
    const onWindowOnline = () => recheckSession();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("online", onWindowOnline);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("online", onWindowOnline);
      if (persistAuthSession) {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, [setUser, mergeUser, setAuthReady, setPendingApproval, applySessionFastThenProfile, applySessionToStore, fetchProfile, revalidateAuthState]);
}
