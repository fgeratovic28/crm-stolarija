import { Shield, Check, MoreVertical, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { useRole } from "@/contexts/RoleContext";
import { ROLE_CONFIG, type UserRole } from "@/types";
import { useUsers, type UserListItem } from "@/hooks/use-users";
import { useAuthStore } from "@/stores/auth-store";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function UsersPage() {
  const {
    users,
    isLoading,
    updateRole,
    updateFullName,
    updateUserActive,
    removeUser,
    isUpdating,
    isUpdatingFullName,
    isUpdatingActive,
    isRemovingUser,
  } = useUsers();
  const { currentRole } = useRole();
  const { toast } = useToast();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingFullName, setEditingFullName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UserListItem | null>(null);

  const mutatingBusy = isUpdating || isUpdatingFullName || isUpdatingActive || isRemovingUser;
  const pendingCount = users?.filter((u) => !u.role).length ?? 0;
  const activeCount = users?.filter((u) => u.active).length ?? 0;

  const getDisplayName = (fullName?: string, name?: string, email?: string) => {
    const candidate = (fullName && fullName.trim()) || (name && name.trim()) || (email?.split("@")[0] ?? "Korisnik");
    return candidate;
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      await updateRole({ userId, role: newRole });
      toast({
        title: "Uloga ažurirana",
        description: `Korisniku je dodeljena nova uloga: ${ROLE_CONFIG[newRole].label}`,
      });
    } catch (err) {
      console.error("Error updating role:", err);
      toast({
        title: "Greška",
        description: "Nije uspelo ažuriranje uloge.",
        variant: "destructive",
      });
    }
  };

  const openFullNameDialog = (userId: string, currentValue?: string, fallback?: string) => {
    setEditingUserId(userId);
    setEditingFullName((currentValue || fallback || "").trim());
    setNameDialogOpen(true);
  };

  const submitFullNameChange = async () => {
    if (!editingUserId) return;
    const trimmed = editingFullName.trim();
    if (!trimmed) return;
    try {
      await updateFullName({ userId: editingUserId, fullName: trimmed });
      toast({
        title: "Sačuvano",
        description: "Ime i prezime je ažurirano.",
      });
      setNameDialogOpen(false);
      setEditingUserId(null);
      setEditingFullName("");
    } catch (err) {
      console.error("Error updating full_name:", err);
      toast({
        title: "Greška",
        description: "Nije uspelo ažuriranje imena i prezimena.",
        variant: "destructive",
      });
    }
  };

  const handleActiveChange = async (userId: string, active: boolean) => {
    if (userId === currentUserId && !active) {
      toast({
        title: "Nije dozvoljeno",
        description: "Ne možete sami isključiti aktivnost svog naloga.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateUserActive({ userId, active });
      toast({
        title: active ? "Nalog aktiviran" : "Nalog deaktiviran",
        description: active ? "Korisnik može ponovo da pristupi aplikaciji." : "Korisnik više ne može da pristupi aplikaciji.",
      });
    } catch (err) {
      console.error("Error updating active:", err);
      toast({
        title: "Greška",
        description: "Nije uspelo ažuriranje statusa naloga.",
        variant: "destructive",
      });
    }
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget || deleteTarget.id === currentUserId) return;
    try {
      await removeUser(deleteTarget.id);
      toast({
        title: "Korisnik obrisan",
        description: "Nalog je uklonjen iz sistema.",
      });
      setDeleteTarget(null);
    } catch (err) {
      console.error("Error removing user:", err);
      toast({
        title: "Greška",
        description:
          err && typeof err === "object" && "message" in err && typeof (err as Error).message === "string"
            ? (err as Error).message
            : "Brisanje nije uspelo. Proverite da li je migracija (admin_delete_user) primenjena na bazi.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <AppLayout><TableSkeleton rows={5} cols={4} /></AppLayout>;

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: "Korisnici i uloge" }]} />
        <PageHeader title="Korisnici i uloge" description="Upravljanje članovima tima i dozvolama pristupa" icon={Shield} />
        <div className="mb-4 flex flex-wrap gap-2">
          <GenericBadge label={`Ukupno: ${users?.length ?? 0}`} variant="muted" />
          <GenericBadge label={`Aktivni: ${activeCount}`} variant="success" />
          <GenericBadge label={`Čeka odobrenje: ${pendingCount}`} variant={pendingCount > 0 ? "warning" : "muted"} />
        </div>

        <div className="bg-card rounded-xl border border-border mb-6 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-border">
            <h2 className="font-semibold text-foreground text-sm">Članovi tima</h2>
          </div>
          {/* Desktop table */}
          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Ime i prezime", "Email adresa", "Uloga", "Status", "Akcije"].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users?.map(u => (
                  <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0 uppercase">
                          {getDisplayName(u.fullName, u.name, u.email).split(" ").map(n => n[0]).join("")}
                        </div>
                        <span className="text-sm font-medium">{getDisplayName(u.fullName, u.name, u.email)}</span>
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3 text-sm text-muted-foreground">{u.email}</td>
                    <td className="px-4 lg:px-5 py-3">
                      {u.role ? (
                        <GenericBadge label={ROLE_CONFIG[u.role]?.label || u.role} variant="info" />
                      ) : (
                        <GenericBadge label="Čeka odobrenje" variant="warning" />
                      )}
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <GenericBadge label={u.active ? "Aktivan" : "Neaktivan"} variant={u.active ? "success" : "muted"} />
                        {currentRole === "admin" && (
                          <div className="flex items-center gap-2" title="Aktivan nalog može da se prijavi u CRM (uz dodeljenu ulogu).">
                            <Switch
                              checked={u.active}
                              disabled={mutatingBusy || (u.id === currentUserId && u.active)}
                              onCheckedChange={(checked) => void handleActiveChange(u.id, checked)}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      {currentRole === "admin" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={mutatingBusy}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Akcije korisnika</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => openFullNameDialog(u.id, u.fullName, u.name)}
                              disabled={isUpdatingFullName}
                            >
                              Izmeni ime i prezime
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {(Object.keys(ROLE_CONFIG) as UserRole[]).map((role) => (
                              <DropdownMenuItem
                                key={role}
                                onClick={() => handleRoleChange(u.id, role)}
                                className="flex items-center justify-between"
                              >
                                {ROLE_CONFIG[role].label}
                                {u.role === role && <Check className="w-4 h-4 text-success" />}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={mutatingBusy || u.id === currentUserId}
                              onClick={() => setDeleteTarget(u)}
                            >
                              <Trash2 className="w-4 h-4 mr-2 inline-block align-middle" />
                              Obriši nalog
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile list */}
          <div className="sm:hidden divide-y divide-border">
            {users?.map(u => (
              <div key={u.id} className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0 uppercase">
                  {getDisplayName(u.fullName, u.name, u.email).split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{getDisplayName(u.fullName, u.name, u.email)}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <div className="flex items-center gap-2">
                    {u.role ? (
                      <GenericBadge label={ROLE_CONFIG[u.role]?.label || u.role} variant="info" />
                    ) : (
                      <GenericBadge label="Čeka odobrenje" variant="warning" />
                    )}
                    {currentRole === "admin" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={mutatingBusy}>
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Akcije korisnika</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => openFullNameDialog(u.id, u.fullName, u.name)}
                            disabled={isUpdatingFullName}
                          >
                            Izmeni ime i prezime
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {(Object.keys(ROLE_CONFIG) as UserRole[]).map((role) => (
                            <DropdownMenuItem
                              key={role}
                              onClick={() => handleRoleChange(u.id, role)}
                              className="flex items-center justify-between"
                            >
                              {ROLE_CONFIG[role].label}
                              {u.role === role && <Check className="w-4 h-4 text-success" />}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            disabled={mutatingBusy || u.id === currentUserId}
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="w-4 h-4 mr-2 inline-block align-middle" />
                            Obriši nalog
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    <GenericBadge label={u.active ? "Aktivan" : "Neaktivan"} variant={u.active ? "success" : "muted"} />
                    {currentRole === "admin" && (
                      <Switch
                        checked={u.active}
                        disabled={mutatingBusy || (u.id === currentUserId && u.active)}
                        onCheckedChange={(checked) => void handleActiveChange(u.id, checked)}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <h2 className="font-semibold text-foreground mb-4 text-sm uppercase tracking-wider">Matrica dozvola po ulogama</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(Object.keys(ROLE_CONFIG) as UserRole[]).map(role => {
            const config = ROLE_CONFIG[role];
            return (
              <div key={role} className={`bg-card rounded-xl border p-4 sm:p-5 transition-all ${role === currentRole ? "border-primary ring-2 ring-primary/20 shadow-sm" : "border-border"}`}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-foreground text-sm">{config.label}</h3>
                  {role === currentRole && <GenericBadge label="Vaša uloga" variant="info" />}
                </div>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{config.description}</p>
                <ul className="space-y-1.5">
                  {config.access.map(a => (
                    <li key={a} className="flex items-center gap-2 text-xs text-foreground">
                      <Check className="w-3 h-3 text-success shrink-0" /> {a}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
          <DialogContent className="w-full sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Izmeni ime i prezime</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="user-full-name">Ime i prezime</Label>
                <Input
                  id="user-full-name"
                  value={editingFullName}
                  onChange={(e) => setEditingFullName(e.target.value)}
                  placeholder="Unesite ime i prezime"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNameDialogOpen(false);
                    setEditingUserId(null);
                    setEditingFullName("");
                  }}
                >
                  Otkaži
                </Button>
                <Button onClick={submitFullNameChange} disabled={isUpdatingFullName || editingFullName.trim().length === 0}>
                  Sačuvaj
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Obrisati korisnika?</AlertDialogTitle>
              <AlertDialogDescription>
                Trajno će biti uklonjen nalog za{" "}
                <span className="font-medium text-foreground">
                  {deleteTarget ? getDisplayName(deleteTarget.fullName, deleteTarget.name, deleteTarget.email) : ""}
                </span>{" "}
                ({deleteTarget?.email}). Ova radnja se ne može poništiti.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRemovingUser}>Otkaži</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={isRemovingUser}
                onClick={() => void confirmDeleteUser()}
              >
                {isRemovingUser ? "Brisanje…" : "Obriši"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageTransition>
    </AppLayout>
  );
}
