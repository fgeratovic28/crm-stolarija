import { create } from "zustand";
import { AppUser } from "@/types";

/** Zašto nema pristupa CRM-u (stranica čekanja / obaveštenje). */
export type AccessBlockReason = "awaiting_role" | "inactive";

interface AuthState {
  user: AppUser | null;
  isAuthenticated: boolean;
  isPendingApproval: boolean;
  /** Kada je isPendingApproval — razlikujemo novog korisnika od deaktiviranog naloga. */
  accessBlockReason: AccessBlockReason | null;
  /** Prvi getSession završen — bez ovoga ProtectedRoute na refresh šalje na /login pre učitane sesije. */
  authReady: boolean;
  /**
   * Prvi pokušaj učitavanja profila iz baze završen (ili odustao). Dok je false, ne tretiramo
   * `isPendingApproval` iz JWT-a — izbegava treptaj /pending-approval kad uloga u JWT-u zaostaje za `users`.
   */
  authProfileReady: boolean;
  setAuthReady: (ready: boolean) => void;
  setAuthProfileReady: (ready: boolean) => void;
  setPendingApproval: (pending: boolean) => void;
  setAccessBlockReason: (reason: AccessBlockReason | null) => void;
  setUser: (user: AppUser | null) => void;
  /** Jedan set posle učitavanja profila — sprečava render gde je user popunjen a isPendingApproval još true. */
  applyAuthProfile: (payload: {
    user: AppUser;
    pendingApproval: boolean;
    accessBlockReason: AccessBlockReason | null;
  }) => void;
  /** Ažurira profil u store-u bez gašenja sesije (npr. posle uspešnog fetch-a). */
  mergeUser: (partial: Partial<AppUser>) => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isAuthenticated: false,
  isPendingApproval: false,
  accessBlockReason: null,
  authReady: false,
  authProfileReady: false,
  setAuthReady: (authReady) => set({ authReady }),
  setAuthProfileReady: (authProfileReady) => set({ authProfileReady }),
  setPendingApproval: (isPendingApproval) => set({ isPendingApproval }),
  setAccessBlockReason: (accessBlockReason) => set({ accessBlockReason }),
  setUser: (user: AppUser | null) =>
    set({
      user,
      isAuthenticated: !!user,
      ...(user ? {} : { isPendingApproval: false, accessBlockReason: null, authProfileReady: false }),
    }),
  applyAuthProfile: ({ user, pendingApproval, accessBlockReason }) =>
    set({
      user,
      isAuthenticated: true,
      isPendingApproval: pendingApproval,
      accessBlockReason,
      authProfileReady: true,
    }),
  mergeUser: (partial) => {
    const cur = get().user;
    if (!cur) return;
    set({ user: { ...cur, ...partial }, isAuthenticated: true });
  },
}));
