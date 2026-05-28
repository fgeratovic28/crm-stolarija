import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Team, ROLE_CONFIG, type UserRole } from "@/types";
import { useToast } from "@/hooks/use-toast";

function isMissingTeamsColumnError(
  error: unknown,
  columnName: "active" | "is_active",
): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return message.includes(`'${columnName}'`) && message.includes("'teams'");
}

function getTeamActiveValue(teamRow: Record<string, unknown>): boolean {
  if (typeof teamRow.active === "boolean") return teamRow.active;
  if (typeof teamRow.is_active === "boolean") return teamRow.is_active;
  return true;
}

async function insertTeamWithSchemaFallback(newTeam: Omit<Team, "id">) {
  const minimalPayload = {
    name: newTeam.name,
    contact_phone: newTeam.contactPhone,
  };

  const withActive = await supabase
    .from("teams")
    .insert([{ ...minimalPayload, active: newTeam.active }])
    .select()
    .single();

  if (!withActive.error) return withActive;
  const activeMissing = isMissingTeamsColumnError(withActive.error, "active");
  if (!activeMissing) return withActive;

  return supabase
    .from("teams")
    .insert([{ ...minimalPayload, is_active: newTeam.active }])
    .select()
    .single();
}

async function updateTeamWithSchemaFallback(team: Team) {
  const minimalPayload = {
    name: team.name,
    contact_phone: team.contactPhone,
  };

  const withActive = await supabase
    .from("teams")
    .update({ ...minimalPayload, active: team.active })
    .eq("id", team.id);

  if (!withActive.error) return withActive;
  const activeMissing = isMissingTeamsColumnError(withActive.error, "active");
  if (!activeMissing) return withActive;

  return supabase
    .from("teams")
    .update({ ...minimalPayload, is_active: team.active })
    .eq("id", team.id);
}

type UserTeamRow = { id: string; name: string; team_id: string | null; role: UserRole | null };

function computeFieldRoleLabel(memberRows: { role: UserRole | null }[]): string {
  if (memberRows.length === 0) return "—";
  const roles = memberRows.map((u) => u.role).filter((r): r is UserRole => r != null);
  if (roles.length === 0) return "Bez uloge";
  const unique = [...new Set(roles)];
  if (unique.length === 1) return ROLE_CONFIG[unique[0]].label;
  return "Mešane uloge";
}

async function validateMemberIdsSameFieldRole(memberIds: string[] | undefined) {
  if (!memberIds?.length) return;
  const { data, error } = await supabase.from("users").select("id, role").in("id", memberIds);
  if (error) throw error;
  const rows = (data ?? []) as Pick<UserTeamRow, "id" | "role">[];
  if (rows.length !== memberIds.length) {
    throw new Error("Neki izabrani korisnici nisu pronađeni.");
  }
  const roles = rows.map((r) => r.role).filter((r): r is UserRole => r != null);
  if (roles.length !== memberIds.length) {
    throw new Error("Svi članovi tima moraju imati dodeljenu ulogu u sistemu.");
  }
  const eligible: UserRole[] = ["montaza", "teren", "production"];
  if (!roles.every((r) => eligible.includes(r))) {
    throw new Error("U timu mogu biti samo uloge Montaža, Teren ili Proizvodnja.");
  }
  const first = roles[0];
  if (!roles.every((r) => r === first)) {
    throw new Error("U istom timu mogu biti samo korisnici sa istom ulogom.");
  }
}

export function useTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("*")
        .order("name");

      if (teamsError) throw teamsError;

      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id, name, team_id, role")
        .not("team_id", "is", null);

      if (usersError) throw usersError;

      const users = usersData as UserTeamRow[];

      return teamsData.map((t: Record<string, unknown>) => {
        const id = t.id as string;
        const memberRows = users.filter((u) => u.team_id === id);
        return {
          id,
          name: t.name as string,
          contactPhone: (t.contact_phone as string) || "",
          fieldRoleLabel: computeFieldRoleLabel(memberRows),
          active: getTeamActiveValue(t),
          members: memberRows.map((u) => u.name),
        } satisfies Team;
      });
    },
  });

  const createTeam = useMutation({
    mutationFn: async (newTeam: Omit<Team, "id"> & { memberIds?: string[] }) => {
      await validateMemberIdsSameFieldRole(newTeam.memberIds);

      const { data, error } = await insertTeamWithSchemaFallback(newTeam);

      if (error) throw error;

      if (newTeam.memberIds && newTeam.memberIds.length > 0) {
        const { error: updateError } = await supabase
          .from("users")
          .update({ team_id: data.id })
          .in("id", newTeam.memberIds);

        if (updateError) throw updateError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "Tim kreiran", description: "Novi tim je uspešno dodat." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  const updateTeam = useMutation({
    mutationFn: async (team: Team & { memberIds?: string[] }) => {
      await validateMemberIdsSameFieldRole(team.memberIds);

      const { error } = await updateTeamWithSchemaFallback(team);

      if (error) throw error;

      const { error: removeError } = await supabase
        .from("users")
        .update({ team_id: null })
        .eq("team_id", team.id);

      if (removeError) throw removeError;

      if (team.memberIds && team.memberIds.length > 0) {
        const { error: assignError } = await supabase
          .from("users")
          .update({ team_id: team.id })
          .in("id", team.memberIds);

        if (assignError) throw assignError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "Tim ažuriran", description: "Promene su uspešno sačuvane." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  const deleteTeam = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("users").update({ team_id: null }).eq("team_id", id);

      const { error } = await supabase.from("teams").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "Tim obrisan", description: "Tim je uspešno uklonjen." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  return {
    teams,
    isLoading,
    createTeam,
    updateTeam,
    deleteTeam,
  };
}
