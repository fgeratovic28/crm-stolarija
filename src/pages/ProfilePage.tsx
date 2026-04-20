import { useEffect, useState } from "react";
import { User, Loader2, Save, Settings, Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { ROLE_CONFIG } from "@/types";
import { toast } from "sonner";

const MIN_PASSWORD_LEN = 6;

function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function ProfilePasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Sakrij šifru" : "Prikaži šifru"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const mergeUser = useAuthStore((s) => s.mergeUser);
  const { currentRole, hasAccess } = useRole();

  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name?.trim() ?? "");
    setFullName(user.fullName?.trim() ?? "");
  }, [user?.id, user?.name, user?.fullName]);

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedFull = fullName.trim();
    if (!trimmedName) {
      toast.error("Korisničko ime je obavezno.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_own_user_profile", {
        p_name: trimmedName,
        p_full_name: trimmedFull,
      });
      if (error) throw error;
      mergeUser({
        name: trimmedName,
        fullName: trimmedFull ? trimmedFull : undefined,
      });
      toast.success("Profil je sačuvan.");
    } catch (err) {
      console.error(err);
      toast.error("Čuvanje nije uspelo. Pokušajte ponovo.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();
    if (!isValidEmail(trimmed)) {
      toast.error("Unesite ispravnu adresu e-pošte.");
      return;
    }
    if (!user?.email) {
      toast.error("Nije učitan nalog.");
      return;
    }
    if (trimmed === user.email.trim().toLowerCase()) {
      toast.info("Adresa je ista kao trenutna.");
      return;
    }
    setSavingEmail(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) throw error;
      const u = data.user;
      if (u?.new_email) {
        toast.info(
          "Potrebna je potvrda: proverite staru i novu e-poštu i kliknite na linkove da bi promena stupila na snagu.",
          { duration: 8000 },
        );
      } else if (u?.email) {
        mergeUser({ email: u.email });
        toast.success("E-pošta je ažurirana.");
      } else {
        toast.success("Zahtev za promenu e-pošte je poslat.");
      }
      setNewEmail("");
    } catch (err: unknown) {
      console.error(err);
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
      toast.error(msg || "Promena e-pošte nije uspela.");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) {
      toast.error("Nije učitan nalog.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LEN) {
      toast.error(`Nova šifra mora imati bar ${MIN_PASSWORD_LEN} karaktera.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Nova šifra i potvrda se ne poklapaju.");
      return;
    }
    setSavingPassword(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signErr) {
        toast.error("Trenutna šifra nije ispravna.");
        return;
      }
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) throw updErr;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Šifra je promenjena.");
    } catch (err: unknown) {
      console.error(err);
      const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
      toast.error(msg || "Promena šifre nije uspela.");
    } finally {
      setSavingPassword(false);
    }
  };

  if (!user) {
    return null;
  }

  const roleLabel =
    currentRole && ROLE_CONFIG[currentRole]
      ? ROLE_CONFIG[currentRole].label
      : "Čeka dodelu uloge";

  return (
    <AppLayout>
      <PageTransition>
        <div className="space-y-6 p-4 md:p-6 max-w-2xl mx-auto">
          <Breadcrumbs items={[{ label: "Profil", href: "/profile" }]} />
          <PageHeader title="Moj profil" description="Osnovni podaci naloga, e-pošta za prijavu i šifra." />

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                <CardTitle>Lični podaci</CardTitle>
              </div>
              <CardDescription>
                Ime i korisničko ime u CRM bazi. Ulogu dodeljuje administrator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmitProfile} className="space-y-6">
                <div className="space-y-2">
                  <Label>Uloga</Label>
                  <Input value={roleLabel} readOnly className="bg-muted" />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="profile-full-name">Ime i prezime</Label>
                  <Input
                    id="profile-full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="npr. Marko Marković"
                    autoComplete="name"
                  />
                  <p className="text-xs text-muted-foreground">Puno ime za dokumenta i prikaz gde je predviđeno.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profile-name">Korisničko ime</Label>
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="npr. mmarkovic"
                    autoComplete="username"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Kratki identifikator; koristi se u aplikaciji ako nema punog imena.</p>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Čuvanje…
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Sačuvaj izmene
                      </>
                    )}
                  </Button>
                  {hasAccess("settings") && (
                    <Button type="button" variant="outline" onClick={() => navigate("/settings")}>
                      <Settings className="w-4 h-4 mr-2" />
                      Podešavanja aplikacije
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                <CardTitle>E-pošta za prijavu</CardTitle>
              </div>
              <CardDescription>
                Trenutna adresa: <span className="font-medium text-foreground">{user.email}</span>. Ako je u projektu uključena
                dvostruka potvrda, dobićete mejl na staru i novu adresu.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangeEmail} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="profile-new-email">Nova e-pošta</Label>
                  <Input
                    id="profile-new-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="nova.adresa@primer.rs"
                    autoComplete="email"
                  />
                </div>
                <Button type="submit" disabled={savingEmail}>
                  {savingEmail ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Šaljem…
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 mr-2" />
                      Promeni e-poštu
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <CardTitle>Šifra</CardTitle>
              </div>
              <CardDescription>
                Unesite trenutnu šifru radi provere, zatim novu šifru (najmanje {MIN_PASSWORD_LEN} karaktera).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <ProfilePasswordField
                  id="profile-current-password"
                  label="Trenutna šifra"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <ProfilePasswordField
                  id="profile-new-password"
                  label="Nova šifra"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <ProfilePasswordField
                  id="profile-confirm-password"
                  label="Potvrdi novu šifru"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <Button type="submit" disabled={savingPassword}>
                  {savingPassword ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Menjam šifru…
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4 mr-2" />
                      Promeni šifru
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {hasAccess("settings") && (
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <SectionHeader title="Firma i obaveštenja" subtitle="Logo, PDV, obaveštenja i jezik aplikacije." />
              <Button variant="link" className="px-0 h-auto mt-2" onClick={() => navigate("/settings")}>
                Otvori stranicu podešavanja →
              </Button>
            </div>
          )}
        </div>
      </PageTransition>
    </AppLayout>
  );
}
