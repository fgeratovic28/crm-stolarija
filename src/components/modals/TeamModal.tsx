import { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Team, ROLE_CONFIG, type UserRole } from "@/types";
import { useUsers } from "@/hooks/use-users";

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (team: (Omit<Team, "id"> | Team) & { memberIds?: string[] }) => void;
  team?: Team;
}

const TEAM_SPECIALTIES = [
  "Montaža",
  "Servis",
  "Merenje",
  "Reklamacije",
  "Kontrolna poseta",
] as const;

export function TeamModal({ isOpen, onClose, onSave, team }: TeamModalProps) {
  const { users, isLoading: usersLoading } = useUsers();
  const [formData, setFormData] = useState<(Omit<Team, "id"> | Team) & { memberIds: string[] }>({
    name: "",
    contactPhone: "",
    specialty: "",
    active: true,
    members: [],
    memberIds: []
  });

  useEffect(() => {
    if (team && isOpen) {
      // Find IDs of existing members based on names (since members in Team are names currently)
      // BUT it's better to fetch user IDs directly from DB.
      // For now, let's assume we need to find them from the `users` list.
      const teamMemberIds = users
        ?.filter(u => u.teamId === team.id)
        .map(u => u.id) || [];

      setFormData({
        ...team,
        specialty: team.specialty || "",
        memberIds: teamMemberIds
      });
    } else if (isOpen) {
      setFormData({
        name: "",
        contactPhone: "",
        specialty: "",
        active: true,
        members: [],
        memberIds: []
      });
    }
  }, [team, isOpen, users]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    onClose();
  };

  const toggleMember = (userId: string) => {
    setFormData(prev => {
      const isSelected = prev.memberIds.includes(userId);
      const newMemberIds = isSelected
        ? prev.memberIds.filter(id => id !== userId)
        : [...prev.memberIds, userId];
      
      return { ...prev, memberIds: newMemberIds };
    });
  };

  const selectedSpecialties = formData.specialty
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

  const toggleSpecialty = (specialty: string) => {
    setFormData((prev) => {
      const current = prev.specialty
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
      const next = current.includes(specialty)
        ? current.filter((item) => item !== specialty)
        : [...current, specialty];
      return { ...prev, specialty: next.join(", ") };
    });
  };

  const fieldUsers =
    users?.filter((u) => u.role === "montaza" || u.role === "teren" || u.role === "production") || [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[min(calc(100vw-1rem),680px)] p-0 sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="px-4 pt-6 sm:px-6">{team ? "Izmeni tim" : "Dodaj novi tim"}</DialogTitle>
          <DialogDescription className="px-4 sm:px-6">
            Unesite detalje o timu ispod. Kliknite na sačuvaj kada završite.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex max-h-[min(75dvh,calc(100dvh-10rem))] flex-col overflow-hidden">
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
              <Label>Specijalnost</Label>
              <div className="rounded-md border p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEAM_SPECIALTIES.map((specialty) => (
                    <div key={specialty} className="flex items-center space-x-2">
                      <Checkbox
                        id={`specialty-${specialty}`}
                        checked={selectedSpecialties.includes(specialty)}
                        onCheckedChange={() => toggleSpecialty(specialty)}
                      />
                      <Label htmlFor={`specialty-${specialty}`} className="text-sm font-normal cursor-pointer">
                        {specialty}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Članovi tima (Montaža / Teren / Proizvodnja)</Label>
              <ScrollArea className="h-36 rounded-md border p-2">
                <div className="space-y-2">
                  {fieldUsers.map((user) => (
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
                          {ROLE_CONFIG[user.role as UserRole]?.label ?? user.role}
                        </span>
                      </Label>
                    </div>
                  ))}
                  {fieldUsers.length === 0 && !usersLoading && (
                    <p className="text-xs text-muted-foreground p-2">Nema dostupnih korisnika za tim (montaža/teren/proizvodnja).</p>
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
