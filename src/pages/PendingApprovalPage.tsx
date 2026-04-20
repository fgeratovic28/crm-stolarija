import { useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { performClientSignOut } from "@/lib/sign-out";
import { useAuthStore } from "@/stores/auth-store";

export default function PendingApprovalPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const accessBlockReason = useAuthStore((state) => state.accessBlockReason);
  const isPendingApproval = useAuthStore((state) => state.isPendingApproval);

  const handleSignOut = async () => {
    await performClientSignOut(queryClient);
  };

  const isInactive = accessBlockReason === "inactive";

  if (!isPendingApproval) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">
          {isInactive ? "Nalog je neaktivan" : "Uloga još nije dodeljena"}
        </h1>
        {isInactive ? (
          <>
            <p className="text-sm text-muted-foreground">
              Prijavljeni ste kao <span className="font-medium text-foreground">{user?.email ?? "korisnik"}</span>.
              Pristup aplikaciji je isključen jer je nalog označen kao neaktivan.
            </p>
            <p className="text-sm text-muted-foreground">
              Obratite se administratoru da ponovo aktivira nalog. Zatim osvežite stranicu ili se ponovo prijavite.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Prijavljeni ste kao <span className="font-medium text-foreground">{user?.email ?? "korisnik"}</span>.
              Administrator još nije dodelio ulogu (npr. Kancelarija / Prodaja ili drugu ulogu) u delu Korisnici.
            </p>
            <p className="text-sm text-muted-foreground">
              Kada uloga bude dodeljena, osvežite stranicu ili se ponovo prijavite.
            </p>
          </>
        )}
        <Button onClick={handleSignOut} variant="secondary" className="w-full">
          Odjavi se
        </Button>
      </div>
    </div>
  );
}
