import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { WorkOrder } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { ensureWorkflowWorkOrders } from "@/lib/work-order-workflow-automation";

export function useWorkOrders(jobId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const runStatusAutomation = async (targetJobId?: string) => {
    if (!targetJobId) return;
    try {
      await recomputeJobStatus(targetJobId, user?.id ?? null);
    } catch (err) {
      console.warn("Auto status recompute failed after work order change:", err);
    }
    try {
      await ensureWorkflowWorkOrders(targetJobId);
    } catch (err) {
      console.warn("ensureWorkflowWorkOrders posle promene RN:", err);
    }
  };

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
        installationRef: (d as { installation_ref?: string | null }).installation_ref ?? undefined,
        productionRef: (d as { production_ref?: string | null }).production_ref ?? undefined,
        job: d.jobs
          ? {
              id: d.jobs.id,
              jobNumber: d.jobs.job_number,
              installationAddress: d.jobs.installation_address,
            }
          : undefined,
      })) as (WorkOrder & { job?: { id: string; jobNumber: string; installationAddress?: string } })[];
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
      await upsertSystemActivity({
        jobId: newOrder.jobId,
        description: `Kreiran radni nalog: ${labelWorkOrderType(newOrder.type)}`,
        systemKey: `work-order-created:${data.id}`,
        authorId: user?.id ?? null,
      });
      await runStatusAutomation(newOrder.jobId);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast({ title: "Radni nalog kreiran", description: "Novi radni nalog je uspešno dodat." });
    },
    onError: (error) => {
      toast({ title: "Greška", description: error.message, variant: "destructive" });
    },
  });

  const updateWorkOrder = useMutation({
    mutationFn: async (order: WorkOrder) => {
      const prev = await supabase.from("work_orders").select("status").eq("id", order.id).single();
      if (prev.error) throw prev.error;
      const previousStatus = prev.data?.status as string | undefined;
      const { error } = await supabase
        .from("work_orders")
        .update({
          type: order.type,
          description: order.description,
          team_id: order.assignedTeamId ?? null,
          date: order.date,
          status: order.status,
        })
        .eq("id", order.id);

      if (error) throw error;
      if (previousStatus && previousStatus !== order.status) {
        await upsertSystemActivity({
          jobId: order.jobId,
          description: `Radni nalog status: ${labelWorkOrderStatus(previousStatus as WorkOrder["status"])} -> ${labelWorkOrderStatus(order.status)}`,
          systemKey: `work-order-status:${order.id}:${previousStatus}:${order.status}`,
          authorId: user?.id ?? null,
        });
      }
      await runStatusAutomation(order.jobId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
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
