import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Hammer, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user, isPendingApproval } = useAuthStore();

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
    document.title = isRegistering ? "Registracija | CRM Stolarija" : "Prijava | CRM Stolarija";
    if (isAuthenticated && isPendingApproval) {
      navigate("/pending-approval", { replace: true });
      return;
    }
    if (isAuthenticated && user && cameFromProtectedRoute) {
      navigate(redirectAfterLogin, { replace: true });
    }
  }, [isAuthenticated, isPendingApproval, user, navigate, isRegistering, redirectAfterLogin, cameFromProtectedRoute]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Greška",
        description: "Molimo unesite email i lozinku.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (isRegistering) {
        // Handle registration
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: email.split('@')[0], // Use part of email as name
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
            description: "Uspešno ste se registrovali. Sada se možete prijaviti.",
          });
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4">
              <Hammer className="w-7 h-7 text-primary-foreground" />
            </div>
            {isAuthenticated && user && !isPendingApproval && !cameFromProtectedRoute && (
              <div className="w-full mb-6 p-4 rounded-xl border border-border bg-muted/40 text-left space-y-3">
                <p className="text-sm text-muted-foreground">
                  Već ste prijavljeni (sesija je deljena između kartica u istom pregledaču). Možete otvoriti
                  aplikaciju ili se ispod prijaviti drugim nalogom.
                </p>
                <Button type="button" variant="secondary" className="w-full" onClick={() => navigate("/", { replace: true })}>
                  Otvori aplikaciju
                </Button>
              </div>
            )}
            <h1 className="text-xl font-bold text-foreground">Stolarija CRM</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isRegistering ? "Kreirajte vaš nalog" : "Prijavite se na vaš nalog"}
            </p>
          </div>

          {!isRegistering && (
            <div className="mb-6 p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Demo pristup</p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Email:</span>
                  <button 
                    type="button"
                    onClick={() => setEmail("admin@stolarija.rs")}
                    className="font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    admin@stolarija.rs
                  </button>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Šifra:</span>
                  <button 
                    type="button"
                    onClick={() => setPassword("123456789")}
                    className="font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    123456789
                  </button>
                </div>
              </div>
              <p className="text-[9px] text-muted-foreground italic mt-2">* Kliknite na podatke iznad za automatsko popunjavanje</p>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
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
            <p className="text-center text-xs text-muted-foreground">
              {isRegistering ? "Već imate nalog?" : "Nemate nalog?"}
              <button 
                type="button" 
                onClick={() => setIsRegistering(!isRegistering)}
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
