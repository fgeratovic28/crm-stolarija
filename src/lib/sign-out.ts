import type { QueryClient } from "@tanstack/react-query";
import { authStorageKey, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

function isLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("lock") || normalized.includes("navigatorlockacquiretimeouterror");
}

async function signOutWithRetry(): Promise<Error | null> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (!error) return null;
    if (!isLockError(error)) return error;
  } catch (error) {
    if (!isLockError(error)) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    return error ?? null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function hasActiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session?.user);
  } catch {
    return false;
  }
}

export async function performClientSignOut(queryClient: QueryClient): Promise<Error | null> {
  let signOutError = await signOutWithRetry();

  // Defensive cleanup in case GoTrue did not fully clear local auth state.
  if (await hasActiveSession()) {
    try {
      window.localStorage.removeItem(authStorageKey);
      window.localStorage.removeItem(`${authStorageKey}-user`);
    } catch {
      /* ignore storage errors */
    }

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (!signOutError) signOutError = error ?? null;
    } catch (error) {
      if (!signOutError) {
        signOutError = error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  try {
    queryClient.clear();
  } catch {
    /* ignore */
  }

  const auth = useAuthStore.getState();
  auth.setPendingApproval(false);
  auth.setUser(null);

  return signOutError;
}
