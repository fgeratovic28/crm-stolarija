import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Team } from "@/types";
import { useToast } from "@/hooks/use-toast";

function isMissingTeamsColumnError(
  error: unknown,
  columnName: "active" | "is_active" | "specialty",
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

function getTeamSpecialtyValue(teamRow: Record<string, unknown>): string {
  return typeof teamRow.specialty === "string" ? teamRow.specialty : "";
}

async function insertTeamWithSchemaFallback(newTeam: Omit<Team, "id">) {
  const minimalPayload = {
    name: newTeam.name,
    contact_phone: newTeam.contactPhone,
  };
  const specialtyPayload = {
    ...minimalPayload,
    specialty: newTeam.specialty,
  };

  const withActive = await supabase
    .from("teams")
    .insert([{ ...specialtyPayload, active: newTeam.active }])
    .select()
    .single();

  if (!withActive.error) return withActive;
  const activeMissing = isMissingTeamsColumnError(withActive.error, "active");
  const specialtyMissing = isMissingTeamsColumnError(withActive.error, "specialty");
  if (!activeMissing && !specialtyMissing) return withActive;

  const withIsActive = await supabase
    .from("teams")
    .insert([
      specialtyMissing
        ? { ...minimalPayload, is_active: newTeam.active }
        : { ...specialtyPayload, is_active: newTeam.active },
    ])
    .select()
    .single();

  if (!withIsActive.error) return withIsActive;
  const isActiveMissing = isMissingTeamsColumnError(withIsActive.error, "is_active");
  const specialtyStillMissing = isMissingTeamsColumnError(withIsActive.error, "specialty");
  if (!isActiveMissing && !specialtyStillMissing) return withIsActive;

  return supabase
    .from("teams")
    .insert([specialtyStillMissing ? minimalPayload : specialtyPayload])
    .select()
    .single();
}

async function updateTeamWithSchemaFallback(team: Team) {
  const minimalPayload = {
    name: team.name,
    contact_phone: team.contactPhone,
  };
  const specialtyPayload = {
    ...minimalPayload,
    specialty: team.specialty,
  };

  const withActive = await supabase
    .from("teams")
    .update({ ...specialtyPayload, active: team.active })
    .eq("id", team.id);

  if (!withActive.error) return withActive;
  const activeMissing = isMissingTeamsColumnError(withActive.error, "active");
  const specialtyMissing = isMissingTeamsColumnError(withActive.error, "specialty");
  if (!activeMissing && !specialtyMissing) return withActive;

  const withIsActive = await supabase
    .from("teams")
    .update(
      specialtyMissing
        ? { ...minimalPayload, is_active: team.active }
        : { ...specialtyPayload, is_active: team.active },
    )
    .eq("id", team.id);

  if (!withIsActive.error) return withIsActive;
  const isActiveMissing = isMissingTeamsColumnError(withIsActive.error, "is_active");
  const specialtyStillMissing = isMissingTeamsColumnError(withIsActive.error, "specialty");
  if (!isActiveMissing && !specialtyStillMissing) return withIsActive;

  return supabase
    .from("teams")
    .update(specialtyStillMissing ? minimalPayload : specialtyPayload)
    .eq("id", team.id);
}

export function useTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: teams, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      // Fetch teams and their members (users with team_id)
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("*")
        .order("name");

      if (teamsError) throw teamsError;

      const { data: usersData, error: usersError } = await supabase
        .from("users")
        .select("id, name, team_id")
        .not("team_id", "is", null);

      if (usersError) throw usersError;

      return teamsData.map((t: Record<string, unknown>) => ({
        id: t.id,
        name: t.name,
        contactPhone: t.contact_phone || "",
        specialty: getTeamSpecialtyValue(t),
        active: getTeamActiveValue(t),
        members: usersData
          .filter(u => u.team_id === t.id)
          .map(u => u.name)
      })) as Team[];
    },
  });

  const createTeam = useMutation({
    mutationFn: async (newTeam: Omit<Team, "id"> & { memberIds?: string[] }) => {
      // 1. Create the team
      const { data, error } = await insertTeamWithSchemaFallback(newTeam);

      if (error) throw error;

      // 2. Assign members if any
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
      // 1. Update team info
      const { error } = await updateTeamWithSchemaFallback(team);

      if (error) throw error;

      // 2. Handle members:
      // First, remove everyone from this team
      const { error: removeError } = await supabase
        .from("users")
        .update({ team_id: null })
        .eq("team_id", team.id);

      if (removeError) throw removeError;

      // Then, assign new members
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
      // 1. Remove team association from users
      await supabase
        .from("users")
        .update({ team_id: null })
        .eq("team_id", id);

      // 2. Delete the team
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
