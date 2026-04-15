import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Activity, CommunicationType } from "@/types";
import { toast } from "sonner";

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
  date: string;
  file_id?: string | null;
  users?: { name?: string } | { name?: string }[] | null;
};

type ErrorWithMessage = { message?: string };
const getErrorMessage = (err: unknown) =>
  typeof err === "object" && err !== null && "message" in err
    ? (err as ErrorWithMessage).message ?? "Nepoznata greška"
    : "Nepoznata greška";

export const mapDbToActivity = (d: ActivityRow): Activity => {
  const userData = Array.isArray(d.users) ? d.users[0] : d.users;
  return {
    id: d.id,
    jobId: d.job_id,
    type: d.type,
    description: d.description,
    createdBy: userData?.name || "Nepoznat",
    createdAt: d.date,
    attachmentName: d.file_id ? "Prilog" : undefined,
  };
};

export function useAllActivities() {
  return useQuery({
    queryKey: ["activities", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(`
          *,
          users (name),
          jobs (job_number)
        `)
        .order("date", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapDbToActivity(row as ActivityRow));
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
          users (name)
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
