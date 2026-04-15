import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function PendingApprovalPage() {
  const { user, setUser } = useAuthStore();

  const handleSignOut = async () => {
    setUser(null);
    await supabase.auth.signOut({ scope: "local" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-sm text-center space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Nalog čeka odobrenje</h1>
        <p className="text-sm text-muted-foreground">
          Prijavljeni ste kao <span className="font-medium text-foreground">{user?.email ?? "korisnik"}</span>, ali
          administrator još nije odobrio nalog i dodelio ulogu.
        </p>
        <p className="text-sm text-muted-foreground">
          Kada odobrenje bude završeno, osvežite stranicu ili se ponovo prijavite.
        </p>
        <Button onClick={handleSignOut} variant="secondary" className="w-full">
          Odjavi se
        </Button>
      </div>
    </div>
  );
}
