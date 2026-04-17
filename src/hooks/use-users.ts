import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { AppUser, UserRole } from "@/types";

export interface UserListItem extends Omit<AppUser, "role"> {
  role: UserRole | null;
}

function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const knownRoles: readonly UserRole[] = [
    "admin",
    "office",
    "finance",
    "procurement",
    "production",
    "montaza",
    "teren",
  ];
  return knownRoles.includes(normalized as UserRole) ? (normalized as UserRole) : null;
}

export function useUsers() {
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return (data ?? []).map((row) => {
        const safeEmail = typeof row.email === "string" ? row.email : "";
        const fallbackName = safeEmail.includes("@") ? safeEmail.split("@")[0] : "Korisnik";
        const safeRole = normalizeRole(row.role);
        return {
          id: row.id,
          name: typeof row.name === "string" && row.name.trim().length > 0 ? row.name : fallbackName,
          fullName: typeof row.full_name === "string" && row.full_name.trim().length > 0 ? row.full_name.trim() : undefined,
          email: safeEmail,
          role: safeRole,
          // `users` tabela u nekim okruženjima nema `active` kolonu (ili je null),
          // pa takve naloge tretiramo kao aktivne da UI ne prikazuje lažno "Neaktivan".
          active:
            typeof row.active === "boolean"
              ? row.active
              : typeof row.is_active === "boolean"
                ? row.is_active
                : true,
          teamId: typeof row.team_id === "string" ? row.team_id : undefined,
          avatar: typeof row.avatar === "string" ? row.avatar : undefined,
        } as UserListItem;
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: UserRole }) => {
      const { error } = await supabase
        .from("users")
        .update({ role })
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const updateFullNameMutation = useMutation({
    mutationFn: async ({ userId, fullName }: { userId: string; fullName: string }) => {
      const { error } = await supabase
        .from("users")
        .update({ full_name: fullName.trim() || null })
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return {
    users,
    isLoading,
    updateRole: updateRoleMutation.mutateAsync,
    updateFullName: updateFullNameMutation.mutateAsync,
    isUpdating: updateRoleMutation.isPending,
    isUpdatingFullName: updateFullNameMutation.isPending,
  };
}
