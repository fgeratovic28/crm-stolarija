import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GoTrueClientOptions } from "@supabase/auth-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing VITE_SUPABASE_URL environment variable");
}

if (!supabaseAnonKey) {
  throw new Error("Missing VITE_SUPABASE_ANON_KEY environment variable");
}

/** Isto kao podrazumevani ključ u supabase-js (`sb-<ref>-auth-token`) — eksplicitno za storage sync u hook-u. */
const baseUrl = new URL(supabaseUrl);
export const authStorageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;

const SINGLETON_KEY = "__crm_stolarija_supabase_client__" as const;
const AUTH_RECOVERY_PROMISE_KEY = "__crm_stolarija_auth_recovery_promise__" as const;

/**
 * Auth sesiju držimo perzistentno u svim kontekstima (tab + installed PWA),
 * jer "display-mode" detekcija može kasniti ili biti nepouzdana na nekim uređajima.
 * To je dovodilo do toga da installirana aplikacija nema stabilan login tok ako se
 * prvi put otvara bez prethodne prijave iz regularnog browser taba.
 */
export const persistAuthSession = true;

/** Minimalna provera kao GoTrue `_isValidSession` + ne-prazni tokeni (trim). */
function isUsablePersistedSession(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  const at = o.access_token;
  const rt = o.refresh_token;
  const exp = o.expires_at;
  if (typeof at !== "string" || at.trim().length === 0) return false;
  if (typeof rt !== "string" || rt.trim().length === 0) return false;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
  // Istekao access_token u storage-u je u redu dok postoji refresh_token — auth-js osvežava pri getSession.
  return true;
}

function isUsableUserBlob(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  return "user" in parsed;
}

/**
 * localStorage adapter: bezbedan JSON parse i brisanje nevalidnih zapisa za session / user ključeve.
 * Ostali ključevi (npr. PKCE code-verifier) prolaze neizmenjeni.
 */
function createSafeLocalStorage(sessionKey: string) {
  return {
    getItem: (key: string): string | null => {
      if (typeof window === "undefined") return null;
      try {
        const ls = window.localStorage;
        const raw = ls.getItem(key);
        if (raw == null) return null;

        if (key !== sessionKey && key !== `${sessionKey}-user`) {
          return raw;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ls.removeItem(key);
          return null;
        }

        if (key === sessionKey) {
          if (!isUsablePersistedSession(parsed)) {
            ls.removeItem(key);
            return null;
          }
          return raw;
        }

        if (!isUsableUserBlob(parsed)) {
          ls.removeItem(key);
          return null;
        }
        return raw;
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* quota / private mode */
      }
    },
    removeItem: (key: string) => {
      if (typeof window === "undefined") return;
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* SecurityError, itd. */
      }
    },
  };
}

/**
 * Kratiji `lockAcquireTimeout` brže „krade” zaključavanje ako drugi tab/PWA ostavi Web Lock da visi.
 * `flowType: pkce` smanjuje konflikte oko fragment tokena između browsera i PWA istog origina.
 * `persistSession` je uvek uključen da bi login radio pouzdano u installiranom PWA scenariju.
 */
function buildAuthOptions(): GoTrueClientOptions {
  return {
    storageKey: authStorageKey,
    flowType: "pkce",
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lockAcquireTimeout: 8000,
    storage: createSafeLocalStorage(authStorageKey),
    persistSession: true,
  };
}

const g = globalThis as typeof globalThis & {
  [SINGLETON_KEY]?: SupabaseClient;
  [AUTH_RECOVERY_PROMISE_KEY]?: Promise<void> | null;
};

function isAuthEndpoint(url: string): boolean {
  return url.includes("/auth/v1/");
}

function toUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function recoverAuthSessionOnce(): Promise<void> {
  if (g[AUTH_RECOVERY_PROMISE_KEY]) {
    await g[AUTH_RECOVERY_PROMISE_KEY];
    return;
  }

  g[AUTH_RECOVERY_PROMISE_KEY] = (async () => {
    const client = g[SINGLETON_KEY];
    if (!client) return;

    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session?.refresh_token) return;
      const { error } = await client.auth.refreshSession();
      if (error) {
        console.warn("Auth recovery refresh failed:", error.message);
      }
    } catch (e) {
      console.warn("Auth recovery failed:", e);
    } finally {
      g[AUTH_RECOVERY_PROMISE_KEY] = null;
    }
  })();

  await g[AUTH_RECOVERY_PROMISE_KEY];
}

/** Posle 401 na REST-u: refresh pa ponovi zahtev (Request.clone / dupliran string body). */
async function fetchWith401Recovery(
  input: RequestInfo | URL,
  requestInit?: RequestInit,
): Promise<Response> {
  const first = await fetch(input, requestInit);
  if (first.status !== 401) return first;

  if (isAuthEndpoint(toUrlString(input))) return first;

  await recoverAuthSessionOnce();

  if (input instanceof Request) {
    return fetch(input.clone(), requestInit);
  }
  if (requestInit && typeof requestInit.body === "string") {
    return fetch(input, { ...requestInit, body: requestInit.body });
  }
  return fetch(input, requestInit);
}

export const supabase: SupabaseClient =
  g[SINGLETON_KEY] ??
  (g[SINGLETON_KEY] = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: fetchWith401Recovery as typeof fetch,
    },
    auth: buildAuthOptions(),
  }));

export type SupabaseResponse<T> = {
  data: T | null;
  error: Error | null;
};
