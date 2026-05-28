import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppSessionLoadingScreen } from "@/components/AppSessionLoadingScreen";
import {
  hasRichSplashCompleted,
  markEntrySplashShownThisPageLoad,
  markRichSplashCompleted,
} from "@/lib/rich-splash-session";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { TermoPlastCrmTitle } from "@/components/shared/TermoPlastCrmTitle";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export default function LoginPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, isPendingApproval, authReady, authProfileReady } = useAuthStore();
  const [bootScreenDone, setBootScreenDone] = useState(() => hasRichSplashCompleted());
  const onBootScreenComplete = useCallback(() => {
    markRichSplashCompleted();
    markEntrySplashShownThisPageLoad();
    setBootScreenDone(true);
  }, []);

  const redirectAfterLogin = useMemo(() => {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    if (from && from !== "/login" && from.startsWith("/")) return from;
    return "/";
  }, [location.state]);

  /** Samo kad te ProtectedRoute pošalje ovde — ne i kad ručno otvoriš /login (npr. druga kartica sa već aktivnom sesijom). */
  const cameFromProtectedRoute = useMemo(() => {
    const s = location.state as { from?: { pathname?: string } } | null | undefined;
    return Boolean(s?.from?.pathname);
  }, [location.state]);

  useEffect(() => {
    document.title = isRegistering ? "Registracija | Termo Plast CRM" : "Prijava | Termo Plast CRM";
    if (isAuthenticated && authProfileReady && isPendingApproval) {
      navigate("/pending-approval", { replace: true });
      return;
    }
    if (isAuthenticated && user && authProfileReady && !isPendingApproval && cameFromProtectedRoute) {
      navigate(redirectAfterLogin, { replace: true });
    }
  }, [
    isAuthenticated,
    authProfileReady,
    isPendingApproval,
    user,
    navigate,
    isRegistering,
    redirectAfterLogin,
    cameFromProtectedRoute,
  ]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (isRegistering && !fullName.trim())) {
      toast({
        title: "Greška",
        description: isRegistering
          ? "Molimo unesite ime i prezime, email i lozinku."
          : "Molimo unesite email i lozinku.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegistering) {
        const cleanFullName = fullName.trim();
        // Handle registration
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: cleanFullName,
              name: cleanFullName,
            }
          }
        });

        if (error) {
          toast({
            title: "Greška pri registraciji",
            description: error.message,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Nalog kreiran",
            description:
              "Uspešno ste se registrovali. Prijavom ćete videti status naloga dok administrator ne dodeli ulogu.",
          });
          setFullName("");
          setIsRegistering(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          toast({
            title: "Greška pri prijavi",
            description: error.message === "Invalid login credentials" 
              ? "Neispravan email ili lozinka." 
              : error.message,
            variant: "destructive",
          });
        } else {
          await supabase.auth.getSession();
          toast({
            title: "Uspešna prijava",
            description: "Dobrodošli nazad!",
          });
          navigate(redirectAfterLogin, { replace: true });
        }
      }
    } catch (err) {
      console.error("Auth error:", err);
      toast({
        title: "Greška",
        description: "Došlo je do neočekivane greške.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!bootScreenDone) {
    return (
      <AppSessionLoadingScreen
        sessionReady={authReady}
        variant="boot"
        onReadyVisualComplete={onBootScreenComplete}
      />
    );
  }

  if (!authReady) {
    return <AppSessionLoadingScreen sessionReady={false} appearance="spinner" />;
  }

  if (isAuthenticated && !authProfileReady) {
    return <AppSessionLoadingScreen sessionReady={false} appearance="spinner" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute right-3 top-3 sm:right-5 sm:top-5 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-8 sm:p-10">
          <div className="flex flex-col items-center mb-8">
            <div className="mb-5 flex justify-center px-1">
              <div className="rounded-xl bg-white p-2 shadow-sm ring-1 ring-border/80 dark:bg-white dark:ring-white/20">
                <img
                  src="/logo.png"
                  alt="Termoplast"
                  className="h-[4.5rem] w-auto max-w-full object-contain"
                  width={280}
                  height={80}
                  decoding="async"
                />
              </div>
            </div>
            {isAuthenticated && user && authProfileReady && !isPendingApproval && !cameFromProtectedRoute && (
              <div className="w-full mb-6 p-4 rounded-xl border border-border bg-muted/40 text-left space-y-3">
                <p className="text-base text-muted-foreground leading-relaxed">
                  Već ste prijavljeni (sesija je deljena između kartica u istom pregledaču). Možete otvoriti
                  aplikaciju ili se ispod prijaviti drugim nalogom.
                </p>
                <Button type="button" variant="secondary" className="w-full" onClick={() => navigate("/", { replace: true })}>
                  Otvori aplikaciju
                </Button>
              </div>
            )}
            <h1 className="text-2xl tracking-tight">
              <TermoPlastCrmTitle />
            </h1>
            <p className="text-base text-muted-foreground mt-2">
              {isRegistering ? "Kreirajte vaš nalog" : "Prijavite se na vaš nalog"}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {isRegistering && (
              <div className="space-y-2">
                <Label htmlFor="full-name">Ime i prezime</Label>
                <Input
                  id="full-name"
                  type="text"
                  placeholder="Petar Petrović"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email adresa</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="vas@email.com" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Lozinka</Label>
                {!isRegistering && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={async () => {
                      const trimmed = email.trim();
                      if (!trimmed) {
                        toast({
                          title: "Email potreban",
                          description: "Unesite email adresu pa ponovo kliknite „Zaboravili ste?”.",
                          variant: "destructive",
                        });
                        return;
                      }
                      try {
                        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
                          redirectTo: `${window.location.origin}/login`,
                        });
                        if (resetErr) {
                          toast({
                            title: "Greška",
                            description: resetErr.message,
                            variant: "destructive",
                          });
                        } else {
                          toast({
                            title: "Email poslat",
                            description: "Ako nalog postoji, proverite poštu za link za reset lozinke.",
                          });
                        }
                      } catch {
                        toast({
                          title: "Greška",
                          description: "Slanje emaila za reset nije uspelo.",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    Zaboravili ste?
                  </button>
                )}
              </div>
              <div className="relative">
                <Input 
                  id="password" 
                  type={showPassword ? "text" : "password"} 
                  placeholder="••••••••" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  className="pr-10"
                  required
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isRegistering ? "Registracija..." : "Prijavljivanje..."}
                </>
              ) : (
                isRegistering ? "Registruj se" : "Prijavi se"
              )}
            </Button>
          </form>
          <div className="mt-6 space-y-2">
            <p className="text-center text-sm text-muted-foreground">
              {isRegistering ? "Već imate nalog?" : "Nemate nalog?"}
              <button 
                type="button" 
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setFullName("");
                }}
                className="ml-1 text-primary hover:underline font-medium"
              >
                {isRegistering ? "Prijavite se" : "Registrujte se"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
