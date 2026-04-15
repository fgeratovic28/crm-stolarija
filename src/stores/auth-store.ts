import { create } from "zustand";
import { AppUser } from "@/types";

interface AuthState {
  user: AppUser | null;
  isAuthenticated: boolean;
  isPendingApproval: boolean;
  /** Prvi getSession završen — bez ovoga ProtectedRoute na refresh šalje na /login pre učitane sesije. */
  authReady: boolean;
  setAuthReady: (ready: boolean) => void;
  setPendingApproval: (pending: boolean) => void;
  setUser: (user: AppUser | null) => void;
  /** Ažurira profil u store-u bez gašenja sesije (npr. posle uspešnog fetch-a). */
  mergeUser: (partial: Partial<AppUser>) => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isPendingApproval: false,
  authReady: false,
  setAuthReady: (authReady) => set({ authReady }),
  setPendingApproval: (isPendingApproval) => set({ isPendingApproval }),
  setUser: (user: AppUser | null) =>
    set({
      user,
      isAuthenticated: !!user,
      ...(user ? {} : { isPendingApproval: false }),
    }),
  mergeUser: (partial) => {
    const cur = get().user;
    if (!cur) return;
    set({ user: { ...cur, ...partial }, isAuthenticated: true });
  },
}));
