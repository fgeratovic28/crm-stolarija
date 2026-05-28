import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Team, ROLE_CONFIG, type UserRole } from "@/types";
import { useUsers } from "@/hooks/use-users";
import { useToast } from "@/hooks/use-toast";

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (team: (Omit<Team, "id"> | Team) & { memberIds?: string[] }) => void;
  team?: Team;
}

const FIELD_TEAM_ROLES: UserRole[] = ["montaza", "teren", "production"];

export function TeamModal({ isOpen, onClose, onSave, team }: TeamModalProps) {
  const { toast } = useToast();
  const { users, isLoading: usersLoading } = useUsers();
  const [formData, setFormData] = useState<(Omit<Team, "id"> | Team) & { memberIds: string[] }>({
    name: "",
    contactPhone: "",
    fieldRoleLabel: "—",
    active: true,
    members: [],
    memberIds: [],
  });

  useEffect(() => {
    if (team && isOpen) {
      const teamMemberIds = users?.filter((u) => u.teamId === team.id).map((u) => u.id) || [];

      setFormData({
        ...team,
        memberIds: teamMemberIds,
      });
    } else if (isOpen) {
      setFormData({
        name: "",
        contactPhone: "",
        fieldRoleLabel: "—",
        active: true,
        members: [],
        memberIds: [],
      });
    }
  }, [team, isOpen, users]);

  const lockedRole = useMemo((): UserRole | null => {
    if (formData.memberIds.length === 0) return null;
    const first = users?.find((u) => u.id === formData.memberIds[0]);
    const r = first?.role;
    return r && FIELD_TEAM_ROLES.includes(r) ? r : null;
  }, [formData.memberIds, users]);

  const fieldUsers =
    users?.filter((u) => u.role && FIELD_TEAM_ROLES.includes(u.role as UserRole)) || [];

  const selectableUsers = useMemo(() => {
    return fieldUsers.filter((u) => {
      if (formData.memberIds.includes(u.id)) return true;
      if (lockedRole) return u.role === lockedRole;
      return true;
    });
  }, [fieldUsers, formData.memberIds, lockedRole]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ids = formData.memberIds;
    if (ids.length > 0) {
      const picked = ids.map((id) => users?.find((u) => u.id === id)).filter(Boolean) as NonNullable<
        (typeof users)[number]
      >[];
      const roles = picked.map((u) => u.role).filter((r): r is UserRole => r != null);
      if (roles.length !== picked.length) {
        toast({
          title: "Greška",
          description: "Svi izabrani članovi moraju imati dodeljenu ulogu.",
          variant: "destructive",
        });
        return;
      }
      if (!roles.every((r) => FIELD_TEAM_ROLES.includes(r))) {
        toast({
          title: "Greška",
          description: "U timu mogu biti samo uloge Montaža, Teren ili Proizvodnja.",
          variant: "destructive",
        });
        return;
      }
      const first = roles[0];
      if (!roles.every((r) => r === first)) {
        toast({
          title: "Greška",
          description: "U istom timu mogu biti samo korisnici sa istom ulogom.",
          variant: "destructive",
        });
        return;
      }
    }
    onSave(formData);
    onClose();
  };

  const toggleMember = (userId: string) => {
    setFormData((prev) => {
      const isSelected = prev.memberIds.includes(userId);
      if (isSelected) {
        return { ...prev, memberIds: prev.memberIds.filter((id) => id !== userId) };
      }
      const user = users?.find((u) => u.id === userId);
      const role = user?.role;
      if (!role || !FIELD_TEAM_ROLES.includes(role as UserRole)) {
        toast({
          title: "Greška",
          description: "Ovaj korisnik nema ulogu pogodnu za terenski tim.",
          variant: "destructive",
        });
        return prev;
      }
      if (prev.memberIds.length > 0) {
        const anchor = users?.find((u) => u.id === prev.memberIds[0]);
        const anchorRole = anchor?.role;
        if (anchorRole && anchorRole !== role) {
          toast({
            title: "Greška",
            description: "Možete dodati samo korisnike sa istom ulogom kao postojeći članovi tima.",
            variant: "destructive",
          });
          return prev;
        }
      }
      return { ...prev, memberIds: [...prev.memberIds, userId] };
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[min(calc(100vw-1rem),680px)] p-0 sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="px-4 pt-6 sm:px-6">{team ? "Izmeni tim" : "Dodaj novi tim"}</DialogTitle>
          <DialogDescription className="px-4 sm:px-6">
            Unesite detalje o timu ispod. Uloga tima određuje se automatski iz uloga članova (svi moraju imati istu
            ulogu). Kliknite na sačuvaj kada završite.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex max-h-[min(75dvh,calc(100dvh-10rem))] flex-col overflow-hidden"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name">Naziv tima</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="npr. Tim Alfa"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Kontakt telefon</Label>
                <Input
                  id="phone"
                  value={formData.contactPhone}
                  onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                  placeholder="+381 6..."
                  required
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Članovi tima (Montaža / Teren / Proizvodnja)</Label>
              {lockedRole && (
                <p className="text-xs text-muted-foreground">
                  Prikazani su korisnici uloge „{ROLE_CONFIG[lockedRole].label}” (isti tim = ista uloga).
                </p>
              )}
              <ScrollArea className="h-36 rounded-md border p-2">
                <div className="space-y-2">
                  {selectableUsers.map((user) => (
                    <div key={user.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`user-${user.id}`}
                        checked={formData.memberIds.includes(user.id)}
                        onCheckedChange={() => toggleMember(user.id)}
                      />
                      <Label
                        htmlFor={`user-${user.id}`}
                        className="text-sm font-normal cursor-pointer flex justify-between w-full gap-2"
                      >
                        <span className="truncate">{user.name}</span>
                        <span className="text-xs text-muted-foreground italic shrink-0">
                          {user.role ? ROLE_CONFIG[user.role as UserRole]?.label ?? user.role : "—"}
                        </span>
                      </Label>
                    </div>
                  ))}
                  {selectableUsers.length === 0 && !usersLoading && (
                    <p className="text-xs text-muted-foreground p-2">
                      Nema dostupnih korisnika za tim (montaža/teren/proizvodnja).
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="flex items-center justify-between space-x-2 rounded-md border p-3">
              <Label htmlFor="active" className="flex flex-col space-y-1">
                <span>Aktivan</span>
                <span className="font-normal text-xs text-muted-foreground">
                  Da li je ovaj tim trenutno dostupan za rad.
                </span>
              </Label>
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
            </div>
          </div>
          <DialogFooter className="border-t px-4 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Otkaži
            </Button>
            <Button type="submit">Sačuvaj</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
