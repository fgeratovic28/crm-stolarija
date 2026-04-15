import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { WorkOrder, Job } from "@/types";
import { isFieldExecutionRole } from "@/lib/field-team-access";

export function useFieldTeamData() {
  const { user } = useAuthStore();

  const { data: workOrders, isLoading: isLoadingOrders, error: ordersError } = useQuery({
    queryKey: ["field-team-work-orders", user?.teamId, user?.role],
    queryFn: async () => {
      if (!user?.teamId || !isFieldExecutionRole(user.role)) return [];

      let q = supabase
        .from("work_orders")
        .select(`
          *,
          job:jobs!inner (
            id,
            job_number,
            installation_address,
            summary,
            customer:customers (
              name,
              phones
            )
          )
        `)
        .eq("team_id", user.teamId)
        .order("date", { ascending: true });

      const { data, error } = await q;

      if (error) throw error;
      
      return data.map(d => ({
        id: d.id,
        jobId: d.job_id,
        type: d.type,
        description: d.description,
        assignedTeamId: d.team_id,
        date: d.date,
        status: d.status,
        attachmentName: d.file_id ? "attachment" : undefined,
        installationRef: d.installation_ref,
        productionRef: d.production_ref,
        job: d.job ? {
          id: d.job.id,
          jobNumber: d.job.job_number,
          installationAddress: d.job.installation_address,
          summary: d.job.summary,
          customer: d.job.customer ? {
            fullName: d.job.customer[0]?.name || d.job.customer.name,
            phones: d.job.customer[0]?.phones || d.job.customer.phones
          } : undefined
        } : undefined
      })) as WorkOrder[];
    },
    enabled: !!user?.teamId && isFieldExecutionRole(user?.role),
  });

  return {
    workOrders,
    isLoading: isLoadingOrders,
    error: ordersError,
  };
}
