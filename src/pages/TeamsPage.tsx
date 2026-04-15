import { useState } from "react";
import { Users, Plus, MoreVertical, Loader2, Phone, Check, X, Pencil, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { PageTransition } from "@/components/shared/PageTransition";
import { TableSkeleton } from "@/components/shared/Skeletons";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { useRole } from "@/contexts/RoleContext";
import { useTeams } from "@/hooks/use-teams";
import { Team } from "@/types";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TeamModal } from "@/components/modals/TeamModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export default function TeamsPage() {
  const { teams, isLoading, createTeam, updateTeam, deleteTeam } = useTeams();
  const { currentRole } = useRole();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | undefined>(undefined);

  const handleAddTeam = () => {
    setSelectedTeam(undefined);
    setModalOpen(true);
  };

  const handleEditTeam = (team: Team) => {
    setSelectedTeam(team);
    setModalOpen(true);
  };

  const handleSaveTeam = (teamData: (Omit<Team, "id"> | Team) & { memberIds?: string[] }) => {
    if ('id' in teamData) {
      updateTeam.mutate(teamData as Team & { memberIds?: string[] });
    } else {
      createTeam.mutate(teamData);
    }
  };

  const handleDeleteTeam = (id: string) => {
    deleteTeam.mutate(id);
  };

  if (isLoading) return <AppLayout><TableSkeleton rows={5} cols={5} /></AppLayout>;

  return (
    <AppLayout>
      <PageTransition>
        <Breadcrumbs items={[{ label: "Terenski timovi" }]} />
        <PageHeader 
          title="Terenski timovi" 
          description="Upravljanje instalacionim i servisnim timovima" 
          icon={Users} 
          actions={
            <Button onClick={handleAddTeam} className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Dodaj tim
            </Button>
          }
        />

        <div className="bg-card rounded-xl border border-border mb-6 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-border">
            <h2 className="font-semibold text-foreground text-sm">Svi timovi</h2>
          </div>
          
          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Naziv tima", "Članovi", "Specijalnost", "Kontakt", "Status", "Akcije"].map(h => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 lg:px-5 py-3 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams?.map(t => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                          {t.name[0]}
                        </div>
                        <span className="text-sm font-medium">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {t.members && t.members.length > 0 ? (
                          t.members.map((m, i) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">
                              {m}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Nema članova</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <span className="text-sm text-muted-foreground">{t.specialty || "-"}</span>
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-3.5 h-3.5" />
                        {t.contactPhone}
                      </div>
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <GenericBadge 
                        label={t.active ? "Aktivan" : "Neaktivan"} 
                        variant={t.active ? "success" : "muted"} 
                      />
                    </td>
                    <td className="px-4 lg:px-5 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Opcije</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleEditTeam(t)}>
                              <Pencil className="w-4 h-4 mr-2" />
                              Izmeni
                            </DropdownMenuItem>
                            <ConfirmDialog
                              trigger={
                                <DropdownMenuItem 
                                  className="text-destructive focus:text-destructive" 
                                  onSelect={(e) => e.preventDefault()}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Obriši
                                </DropdownMenuItem>
                              }
                              title="Obriši tim?"
                              description="Da li ste sigurni da želite da obrišete ovaj tim? Ova akcija se ne može poništiti."
                              confirmLabel="Obriši"
                              variant="destructive"
                              onConfirm={() => handleDeleteTeam(t.id)}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden divide-y divide-border">
              {teams?.map(t => (
                <div key={t.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {t.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {t.contactPhone}
                      </p>
                      {t.specialty && (
                        <p className="text-[10px] text-muted-foreground mt-1 italic">{t.specialty}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <GenericBadge 
                        label={t.active ? "Aktivan" : "Neaktivan"} 
                        variant={t.active ? "success" : "muted"} 
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditTeam(t)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Izmeni
                          </DropdownMenuItem>
                          <ConfirmDialog
                            trigger={
                              <DropdownMenuItem 
                                className="text-destructive focus:text-destructive" 
                                onSelect={(e) => e.preventDefault()}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Obriši
                              </DropdownMenuItem>
                            }
                            title="Obriši tim?"
                            description="Da li ste sigurni da želite da obrišete ovaj tim? Ova akcija se ne može poništiti."
                            confirmLabel="Obriši"
                            variant="destructive"
                            onConfirm={() => handleDeleteTeam(t.id)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 pl-12">
                    {t.members?.map((m, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-secondary text-secondary-foreground">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <TeamModal 
            isOpen={modalOpen} 
            onClose={() => setModalOpen(false)} 
            onSave={handleSaveTeam} 
            team={selectedTeam} 
          />
        </PageTransition>
      </AppLayout>
    );
  }
