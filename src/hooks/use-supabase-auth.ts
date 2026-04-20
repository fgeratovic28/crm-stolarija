import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { markRichSplashCompleted } from "@/lib/rich-splash-session";
import { authStorageKey, persistAuthSession, supabase } from "@/lib/supabase";
import { useAuthStore, type AccessBlockReason } from "@/stores/auth-store";
import { roleHasAppAccess } from "@/config/permissions";
import { AppUser, UserRole } from "@/types";

/** Koliko čekati getSession pre drugog pokušaja / predaje (bez refreshSession petlje). */
const SESSION_RESOLVE_MS = 12_000;
/** Ako se hidracija zaglavi (lock / SW / iOS), ipak pusti UI — inače ostaje „Provera sesije…”. */
const AUTH_READY_WATCHDOG_MS = 10_000;
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
  if (value == null) return null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "object") return null;
  return normalizeRole(String(value));
}

function deriveAccessBlockReason(dbActive: boolean, hasAssignedAppRole: boolean): AccessBlockReason | null {
  const hasPortalAccess = dbActive && hasAssignedAppRole;
  if (hasPortalAccess) return null;
  if (!dbActive && hasAssignedAppRole) return "inactive";
  return "awaiting_role";
}

/** PostgREST / RPC ponekad vraća drugačije ime polja ili „prazan" objekat — izvuci stabilno. */
function getRowField(row: Record<string, unknown>, wanted: string): unknown {
  const w = wanted.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === w) return v;
  }
  return undefined;
}

function coerceRpcUserPayload(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return coerceRpcUserPayload(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return coerceRpcUserPayload(raw[0]);
  }
  if (typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = getRowField(row, "id");
  const email = getRowField(row, "email");
  if (id == null && email == null) return null;
  return row;
}

function coerceMetadataRole(value: unknown): UserRole | null {
  const normalized = normalizeRole(value);
  if (normalized && (KNOWN_ROLES as readonly string[]).includes(normalized)) {
    return normalized as UserRole;
  }
  return null;
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
  const fullNameFromMeta = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const nameFromMeta = typeof meta?.name === "string" ? meta.name.trim() : "";
  const name =
    fullNameFromMeta ||
    nameFromMeta ||
    (typeof u.email === "string" && u.email.includes("@") ? u.email.split("@")[0] : "") ||
    "Korisnik";
  const role: UserRole | null = coerceMetadataRole(meta?.role);
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
  const queryClient = useQueryClient();
  const { setUser, setAuthReady, setPendingApproval, setAccessBlockReason, applyAuthProfile } = useAuthStore();

  const clearQueryCacheOnLogout = useCallback(() => {
    try {
      queryClient.clear();
    } catch {
      /* ignore */
    }
  }, [queryClient]);
  const sessionEffectIdRef = useRef(0);
  const lastSessionRecheckAtRef = useRef(0);
  const sessionRecheckInFlightRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string, fallbackRole: UserRole | null) => {
    try {
      const raced = await raceWithTimeout(
        (async () => {
          const rpc = await supabase.rpc("get_current_user_profile");
          if (!rpc.error) {
            const row = coerceRpcUserPayload(rpc.data);
            if (row) {
              return { data: row, error: null as Error | null };
            }
          }
          if (rpc.error) {
            console.warn("get_current_user_profile RPC failed, falling back to users table:", rpc.error.message);
          }
          return await supabase.from("users").select("*").eq("id", userId).maybeSingle();
        })(),
        PROFILE_FETCH_MS,
      );
      if (raced === null) {
        console.warn("User profile fetch timed out; keeping JWT-derived user if set");
        return null;
      }
      const { data, error } = raced;

      if (error) {
        const code = (error as { code?: string }).code;
        if (code !== "PGRST116") {
          console.error("Error fetching user profile:", error);
        }
        return null;
      }
      if (!data) return null;

      const row = data as Record<string, unknown>;
      const dbRole = normalizeRole(getRowField(row, "role"));
      const hasAssignedAppRole =
        dbRole !== null &&
        (KNOWN_ROLES as readonly string[]).includes(dbRole) &&
        roleHasAppAccess(dbRole);

      const activeVal = getRowField(row, "active");
      const isActiveVal = getRowField(row, "is_active");
      const dbActive =
        typeof activeVal === "boolean"
          ? activeVal
          : typeof isActiveVal === "boolean"
            ? isActiveVal
            : true;

      const hasPortalAccess = dbActive && hasAssignedAppRole;
      const accessBlockReason = deriveAccessBlockReason(dbActive, hasAssignedAppRole);

      const emailRaw = getRowField(row, "email");
      const email = typeof emailRaw === "string" ? emailRaw : "";
      const fullNameRaw = getRowField(row, "full_name");
      const nameFieldRaw = getRowField(row, "name");
      const nameRaw =
        (typeof fullNameRaw === "string" ? fullNameRaw : null) || (typeof nameFieldRaw === "string" ? nameFieldRaw : null);
      const teamIdRaw = getRowField(row, "team_id");
      const teamId = typeof teamIdRaw === "string" ? teamIdRaw : undefined;
      const idRaw = getRowField(row, "id");
      const id = typeof idRaw === "string" ? idRaw : userId;

      return {
        user: {
          id,
          email,
          name: nameRaw || (email.includes("@") ? email.split("@")[0] : "Korisnik"),
          fullName:
            typeof fullNameRaw === "string" && fullNameRaw.trim() ? fullNameRaw.trim() : undefined,
          role: hasAssignedAppRole ? (dbRole as UserRole) : null,
          active: dbActive,
          teamId,
        } as AppUser,
        pendingApproval: !hasPortalAccess,
        accessBlockReason,
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
          setAccessBlockReason(null);
          setUser(null);
        }
        return;
      }
      const existing = useAuthStore.getState().user;
      const sameUser = existing?.id === session.user.id;
      const fallbackUser = appUserFromSessionFallback(session);
      if (!sameUser) {
        if (isActive()) {
          setAccessBlockReason(null);
          setPendingApproval(!roleHasAppAccess(fallbackUser.role));
          setUser(fallbackUser);
        }
      }
      const profile = await fetchProfile(
        session.user.id,
        sameUser ? existing?.role ?? null : fallbackUser.role,
      );
      if (!isActive()) return;
      if (profile) {
        applyAuthProfile({
          user: profile.user,
          pendingApproval: profile.pendingApproval,
          accessBlockReason: profile.accessBlockReason,
        });
      } else {
        // Profil trenutno nije dostupan (RLS/mreža/timeout) — ne zaključavaj validne postojeće naloge.
        setPendingApproval(false);
        setAccessBlockReason(null);
      }
    } catch (e) {
      console.error("applySessionToStore failed:", e);
      if (!isActive() || !session?.user) return;
      try {
        if (!useAuthStore.getState().user) {
          const fallback = appUserFromSessionFallback(session);
          setAccessBlockReason(null);
          setPendingApproval(!roleHasAppAccess(fallback.role));
          setUser(fallback);
        }
      } catch {
        /* ignore */
      }
    }
  }, [applyAuthProfile, fetchProfile, setAccessBlockReason, setPendingApproval, setUser]);

  /** Sinhrono postavi JWT korisnika pa u pozadini dovuci profil — authReady ne čeka mrežu. */
  const applySessionFastThenProfile = useCallback((session: Session | null, isActive: () => boolean) => {
    if (!session?.user) {
      if (isActive()) {
        setPendingApproval(false);
        setAccessBlockReason(null);
        setUser(null);
      }
      return;
    }
    const existing = useAuthStore.getState().user;
    const sameUser = existing?.id === session.user.id;
    const fallbackUser = appUserFromSessionFallback(session);
    if (!sameUser) {
      if (isActive()) {
        setAccessBlockReason(null);
        setPendingApproval(!roleHasAppAccess(fallbackUser.role));
        setUser(fallbackUser);
      }
    }
    void (async () => {
      try {
        const profile = await fetchProfile(
          session.user.id,
          sameUser ? existing?.role ?? null : fallbackUser.role,
        );
        if (!isActive()) return;
        if (profile) {
          applyAuthProfile({
            user: profile.user,
            pendingApproval: profile.pendingApproval,
            accessBlockReason: profile.accessBlockReason,
          });
        } else {
          // Profil trenutno nije dostupan (RLS/mreža/timeout) — ne zaključavaj validne postojeće naloge.
          setPendingApproval(false);
          setAccessBlockReason(null);
        }
      } catch (e) {
        console.error("Background profile fetch failed:", e);
      }
    })();
  }, [applyAuthProfile, fetchProfile, setAccessBlockReason, setPendingApproval, setUser]);

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
              setAccessBlockReason(null);
              setUser(null);
              clearQueryCacheOnLogout();
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
    [applySessionToStore, clearQueryCacheOnLogout, setAccessBlockReason, setPendingApproval, setUser],
  );

  useEffect(() => {
    const effectId = ++sessionEffectIdRef.current;
    const isActive = () => effectId === sessionEffectIdRef.current;

    setAuthReady(false);

    const watchdog = window.setTimeout(() => {
      if (!isActive()) return;
      console.warn("Auth: watchdog — forsirano authReady (hidracija predugo traje)");
      setAuthReady(true);
    }, AUTH_READY_WATCHDOG_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        try {
          if (event === "INITIAL_SESSION") {
            if (session?.user && isActive()) {
              // Ne await-uj ovde: await + fetch profila drži GoTrue lock i može blokirati paralelni getSession u hidraciji (PWA / resume).
              void applySessionToStore(session, isActive);
            }
            // Namerno bez setUser(null) ovde — prazan INITIAL_SESSION ne sme da poništi uspešan getSession.
            return;
          }

          if (event === "SIGNED_IN") {
            if (session?.user && isActive()) {
              void applySessionToStore(session, isActive);
            }
            return;
          }

          if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
            if (session?.user && isActive()) {
              const fallbackRole =
                useAuthStore.getState().user?.role ?? appUserFromSessionFallback(session).role;
              const appUser = await fetchProfile(session.user.id, fallbackRole);
              if (!isActive()) return;
              if (appUser) {
                applyAuthProfile({
                  user: appUser.user,
                  pendingApproval: appUser.pendingApproval,
                  accessBlockReason: appUser.accessBlockReason,
                });
              }
            }
            return;
          }

          if (event === "SIGNED_OUT") {
            // signOut() pre signInWithPassword emituje SIGNED_OUT; ako handler kasni posle SIGNED_IN,
            // naivno setUser(null) briše upravo ulogovanog korisnika. Čistimo store samo ako stvarno nema sesije.
            // getSession unutar ovog callback-a ne sme biti await direktno — GoTrue lock + signOut() = deadlock
            // (vidi Supabase „onAuthStateChange” napomenu). Odloži proveru van callback steka.
            if (!isActive()) return;
            setTimeout(() => {
              void (async () => {
                if (!isActive()) return;
                try {
                  const { data: { session: s } } = await getSessionResilient();
                  if (!isActive()) return;
                  if (!s?.user) {
                    setPendingApproval(false);
                    setUser(null);
                    clearQueryCacheOnLogout();
                  }
                } catch {
                  if (isActive()) {
                    setPendingApproval(false);
                    setUser(null);
                    clearQueryCacheOnLogout();
                  }
                }
              })();
            }, 0);
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

        // Čim znamo ishod getSession, pusti UI — ne čekaj profil niti retry granu (sprečava „Provera sesije” zauvek).
        clearTimeout(watchdog);
        setAuthReady(true);
        markRichSplashCompleted();

        if (error) {
          console.error("Auth getSession on mount:", error);
          if (isActive()) {
            setPendingApproval(false);
            setUser(null);
            clearQueryCacheOnLogout();
          }
          return;
        }
        if (timedOut) {
          console.warn(
            "Auth hydrate: getSession timed out — not clearing session (INITIAL_SESSION may still apply); scheduling retry",
          );
        }
        if (session?.user) {
          try {
            applySessionFastThenProfile(session, isActive);
          } catch (e) {
            console.error("Auth hydrate applySessionFastThenProfile:", e);
            if (isActive()) {
              try {
                const fb = appUserFromSessionFallback(session);
                setAccessBlockReason(null);
                setPendingApproval(!roleHasAppAccess(fb.role));
                setUser(fb);
              } catch {
                if (isActive()) setUser(null);
              }
            }
          }
        } else if (isActive() && !timedOut) {
          // Samo kad getSession potvrdi da nema sesije — timeout nije "nema korisnika" (izbegni trku sa INITIAL_SESSION).
          setPendingApproval(false);
          setUser(null);
        } else if (isActive() && timedOut) {
          void (async () => {
            await sleep(400);
            if (!isActive()) return;
            try {
              const { data: { session: retrySession }, error: retryErr } = await getSessionResilient();
              if (!isActive()) return;
              if (retryErr) {
                console.error("Auth hydrate retry getSession:", retryErr);
                return;
              }
              if (retrySession?.user) {
                applySessionFastThenProfile(retrySession, isActive);
              } else if (!useAuthStore.getState().user) {
                setPendingApproval(false);
                setUser(null);
              }
            } catch (e) {
              console.error("Auth hydrate retry error:", e);
            }
          })();
        }
      } catch (e) {
        console.error("Auth hydrate error:", e);
        clearTimeout(watchdog);
        if (isActive()) {
          setPendingApproval(false);
          setUser(null);
          clearQueryCacheOnLogout();
          setAuthReady(true);
          markRichSplashCompleted();
        }
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
      clearTimeout(watchdog);
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("online", onWindowOnline);
      if (persistAuthSession) {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, [
    clearQueryCacheOnLogout,
    setUser,
    setAuthReady,
    setPendingApproval,
    setAccessBlockReason,
    applyAuthProfile,
    applySessionFastThenProfile,
    applySessionToStore,
    fetchProfile,
    revalidateAuthState,
  ]);
}
