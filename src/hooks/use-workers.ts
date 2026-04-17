import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Worker, WorkerSickLeave } from "@/types";

type WorkerDbRow = Record<string, unknown>;
type SickLeaveDbRow = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Došlo je do neočekivane greške.";
}

function mapWorker(row: WorkerDbRow): Worker {
  return {
    id: row.id as string,
    fullName: row.full_name as string,
    position: (row.position as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    active: (row.active as boolean) ?? true,
    userId: (row.user_id as string | null) ?? null,
    teamId: (row.team_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

function mapSickLeave(row: SickLeaveDbRow): WorkerSickLeave {
  return {
    id: row.id as string,
    workerId: row.worker_id as string,
    reason: row.reason as string,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    daysCount: (row.days_count as number | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export type WorkerUpsert = Omit<Worker, "id" | "createdAt" | "updatedAt">;
export type WorkerUpdate = { id: string } & Omit<Worker, "id" | "createdAt" | "updatedAt">;
export type WorkerSickLeaveUpsert = Omit<WorkerSickLeave, "id" | "createdAt" | "updatedAt">;
export type WorkerSickLeaveUpdate = { id: string } & Omit<WorkerSickLeave, "id" | "createdAt" | "updatedAt">;

export function useWorkers() {
  const queryClient = useQueryClient();

  const workersQuery = useQuery({
    queryKey: ["workers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("workers").select("*").order("full_name");
      if (error) throw error;
      return (data ?? []).map((row) => mapWorker(row as WorkerDbRow));
    },
  });

  const sickLeavesQuery = useQuery({
    queryKey: ["worker-sick-leaves"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("worker_sick_leaves")
        .select("*")
        .order("start_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapSickLeave(row as SickLeaveDbRow));
    },
  });

  const createWorker = useMutation({
    mutationFn: async (payload: WorkerUpsert) => {
      const { data, error } = await supabase
        .from("workers")
        .insert({
          full_name: payload.fullName,
          position: payload.position || null,
          phone: payload.phone || null,
          active: payload.active,
          user_id: payload.userId || null,
          team_id: payload.teamId || null,
          notes: payload.notes || null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return mapWorker(data as WorkerDbRow);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
      toast.success("Radnik je uspešno dodat.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  const updateWorker = useMutation({
    mutationFn: async ({ id, ...payload }: WorkerUpdate) => {
      const { data, error } = await supabase
        .from("workers")
        .update({
          full_name: payload.fullName,
          position: payload.position || null,
          phone: payload.phone || null,
          active: payload.active,
          user_id: payload.userId || null,
          team_id: payload.teamId || null,
          notes: payload.notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapWorker(data as WorkerDbRow);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
      toast.success("Radnik je uspešno ažuriran.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  const deleteWorker = useMutation({
    mutationFn: async (workerId: string) => {
      const { error } = await supabase.from("workers").delete().eq("id", workerId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workers"] });
      void queryClient.invalidateQueries({ queryKey: ["worker-sick-leaves"] });
      toast.success("Radnik je obrisan.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  const createSickLeave = useMutation({
    mutationFn: async (payload: WorkerSickLeaveUpsert) => {
      const { data, error } = await supabase
        .from("worker_sick_leaves")
        .insert({
          worker_id: payload.workerId,
          reason: payload.reason,
          start_date: payload.startDate || null,
          end_date: payload.endDate || null,
          days_count: payload.daysCount ?? null,
          note: payload.note || null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return mapSickLeave(data as SickLeaveDbRow);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker-sick-leaves"] });
      toast.success("Bolovanje je sačuvano.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  const updateSickLeave = useMutation({
    mutationFn: async ({ id, ...payload }: WorkerSickLeaveUpdate) => {
      const { data, error } = await supabase
        .from("worker_sick_leaves")
        .update({
          worker_id: payload.workerId,
          reason: payload.reason,
          start_date: payload.startDate || null,
          end_date: payload.endDate || null,
          days_count: payload.daysCount ?? null,
          note: payload.note || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapSickLeave(data as SickLeaveDbRow);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker-sick-leaves"] });
      toast.success("Bolovanje je ažurirano.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  const deleteSickLeave = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("worker_sick_leaves").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker-sick-leaves"] });
      toast.success("Bolovanje je obrisano.");
    },
    onError: (err: unknown) => toast.error(`Greška: ${getErrorMessage(err)}`),
  });

  return {
    workers: workersQuery.data ?? [],
    sickLeaves: sickLeavesQuery.data ?? [],
    isLoading: workersQuery.isLoading || sickLeavesQuery.isLoading,
    createWorker,
    updateWorker,
    deleteWorker,
    createSickLeave,
    updateSickLeave,
    deleteSickLeave,
  };
}
