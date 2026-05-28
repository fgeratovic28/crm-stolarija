import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Activity, CommunicationType } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";

export interface CreateActivityInput {
  jobId: string;
  type: CommunicationType;
  description: string;
  authorId: string;
  fileId?: string;
}

type ActivityRow = {
  id: string;
  job_id: string;
  type: CommunicationType;
  description: string;
  system_key?: string | null;
  date: string;
  file_id?: string | null;
  users?: { name?: string } | { name?: string }[] | null;
  files?: { id?: string; storage_key?: string | null; storage_url?: string | null } | null;
};

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

export const mapDbToActivity = (d: ActivityRow): Activity => {
  const userData = Array.isArray(d.users) ? d.users[0] : d.users;
  const fileData = d.files && !Array.isArray(d.files) ? d.files : null;
  return {
    id: d.id,
    jobId: d.job_id,
    type: d.type,
    description: d.description,
    systemKey: d.system_key ?? undefined,
    createdBy: userData?.name || "Nepoznat",
    createdAt: d.date,
    attachmentName: d.file_id ? "Prilog" : undefined,
    attachmentFileId: d.file_id ?? undefined,
  };
};

export function useAllActivities() {
  const role = useAuthStore((s) => s.user?.role);

  return useQuery({
    queryKey: ["activities", "all", role ?? "none"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(`
          *,
          users (name),
          files (id, storage_key, storage_url)
        `)
        .order("date", { ascending: false });

      if (error) throw error;
      const list = (data ?? []).map((row) => mapDbToActivity(row as ActivityRow));
      if (role === "office") {
        return list.filter((a) => {
          const sk = (a.systemKey ?? "").toLowerCase();
          if (sk.startsWith("material-order-")) return false;
          const d = (a.description ?? "").toLowerCase();
          if (d.includes("prilog narudžbine materijala")) return false;
          if (d.includes("prilog narudzbine materijala")) return false;
          return true;
        });
      }
      return list;
    },
  });
}

export function useActivities() {
  const queryClient = useQueryClient();

  const addActivity = useMutation({
    mutationFn: async (input: CreateActivityInput) => {
      const { data, error } = await supabase
        .from("activities")
        .insert([{
          job_id: input.jobId,
          type: input.type,
          description: input.description,
          author_id: input.authorId,
          file_id: input.fileId,
          date: new Date().toISOString(),
        }])
        .select(`
          *,
          users (name),
          files (id, storage_key, storage_url)
        `)
        .single();

      if (error) throw error;
      
      const userData = Array.isArray(data.users) ? data.users[0] : data.users;
      return {
        id: data.id,
        jobId: data.job_id,
        type: data.type,
        description: data.description,
        createdBy: userData?.name || "Nepoznat",
        createdAt: data.date,
        attachmentName: data.file_id ? "Prilog" : undefined,
        attachmentFileId: data.file_id ?? undefined,
      } as Activity;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      toast.success("Aktivnost uspešno dodata");
    },
    onError: (err: unknown) => {
      toast.error("Greška pri dodavanju aktivnosti", { description: getErrorMessage(err) });
    },
  });

  return {
    addActivity,
  };
}
