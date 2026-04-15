import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { WorkOrder } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { isFieldExecutionRole } from "@/lib/field-team-access";

export function useWorkOrders(jobId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: workOrders, isLoading, isError, error } = useQuery({
    queryKey: ["work-orders", jobId, user?.id, user?.role],
    queryFn: async () => {
      let query = supabase
        .from("work_orders")
        .select(`
          *,
          jobs (id, job_number, installation_address)
        `)
        .order("date", { ascending: false });

      if (jobId) {
        query = query.eq("job_id", jobId);
      }

      if (user && isFieldExecutionRole(user.role)) {
        if (user.teamId) {
          query = query.eq("team_id", user.teamId);
        } else {
          return [];
        }
      }

      const { data, error: queryError } = await query;

      if (queryError) throw queryError;

      const rows = Array.isArray(data) ? data : [];

      return rows.map((d) => ({
        id: d.id,
        jobId: d.job_id,
        type: d.type,
        description: d.description,
        assignedTeamId: d.team_id,
        date: d.date,
        status: d.status,
        attachmentName: d.file_id ? "attachment" : undefined,
        installationRef: undefined,
        productionRef: undefined,
        job: d.jobs ? { 
          id: d.jobs.id, 
          jobNumber: d.jobs.job_number,
          installationAddress: d.jobs.installation_address 
        } : undefined
      })) as (WorkOrder & { job?: { id: string, jobNumber: string, installationAddress?: string } })[];
    },
  });

  const createWorkOrder = useMutation({
    mutationFn: async (newOrder: Omit<WorkOrder, "id">) => {
      if (!newOrder.jobId) {
        throw new Error("Posao je obavezan za radni nalog.");
      }
      if (!newOrder.assignedTeamId) {
        throw new Error("Tim je obavezan za radni nalog.");
      }
      const { data, error } = await supabase
        .from("work_orders")
        .insert([{
          job_id: newOrder.jobId,
          type: newOrder.type,
          description: newOrder.description,
          team_id: newOrder.assignedTeamId,
          date: newOrder.date,
          status: newOrder.status,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      toast({ title: "Radni nalog kreiran", description: "Novi radni nalog je uspešno dodat." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  const updateWorkOrder = useMutation({
    mutationFn: async (order: WorkOrder) => {
      if (!order.assignedTeamId) {
        throw new Error("Tim je obavezan za radni nalog.");
      }
      const { error } = await supabase
        .from("work_orders")
        .update({
          type: order.type,
          description: order.description,
          team_id: order.assignedTeamId,
          date: order.date,
          status: order.status,
        })
        .eq("id", order.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      toast({ title: "Radni nalog ažuriran", description: "Promene su uspešno sačuvane." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  return {
    workOrders,
    isLoading,
    isError,
    error,
    createWorkOrder,
    updateWorkOrder,
  };
}
