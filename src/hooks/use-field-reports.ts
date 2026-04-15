import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { FieldReport } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { formatQueryError } from "@/lib/utils";

export function useFieldReports(jobId?: string, workOrderId?: string) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: reports, isLoading, isError, error } = useQuery({
    queryKey: ["field-reports", jobId, workOrderId, user?.id, user?.role],
    enabled: !!user,
    retry: 1,
    queryFn: async () => {
      if (!user) return [];

      const workOrderNested = jobId
        ? "work_orders!inner ( job_id, jobs ( id, job_number, customers (name) ) )"
        : "work_orders ( job_id, jobs ( id, job_number, customers (name) ) )";

      let query = supabase.from("field_reports").select(`*, ${workOrderNested}`);

      if (jobId) {
        query = query.eq("work_orders.job_id", jobId);
      }

      if (workOrderId) {
        query = query.eq("work_order_id", workOrderId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const rows = Array.isArray(data) ? data : [];

      return rows.map((d) => {
        const wo = d.work_orders;
        const woRow = Array.isArray(wo) ? wo[0] : wo;
        const jobEmb = woRow?.jobs;
        const jobRow = Array.isArray(jobEmb) ? jobEmb[0] : jobEmb;
        const custRaw = jobRow?.customers;
        const customer = Array.isArray(custRaw) ? custRaw[0] : custRaw;

        const resolvedJobId =
          (d.job_id as string | undefined) ?? woRow?.job_id ?? jobId ?? "";

        return {
          id: d.id,
          jobId: resolvedJobId,
          address: "Adresa nije upisana",
          arrived: !!d.arrived,
          arrivalDate: d.arrival_datetime,
          siteCanceled: false,
          cancelReason: undefined,
          jobCompleted: !!d.completed,
          everythingOk: true,
          issueDescription: d.issues,
          images: d.images || [],
          missingItems: d.missing_items || [],
          additionalNeeds: d.additional_needs || [],
          measurements: d.measurements,
          generalNotes: d.general_report,
          workOrderId: d.work_order_id,
          job: jobRow
            ? {
                id: jobRow.id,
                jobNumber: jobRow.job_number,
                customer: customer
                  ? {
                      fullName: customer.name || "Nepoznat",
                    }
                  : undefined,
              }
            : undefined,
        };
      }) as FieldReport[];
    },
  });

  const createReport = useMutation({
    mutationFn: async (report: Omit<FieldReport, "id"> & { workOrderId?: string }) => {
      const reportData = {
        work_order_id: report.workOrderId || null,
        arrived: report.arrived,
        arrival_datetime: report.arrivalDate,
        completed: report.jobCompleted,
        issues: report.issueDescription,
        images: report.images,
        missing_items: report.missingItems,
        additional_needs: report.additionalNeeds,
        measurements: report.measurements,
        general_report: report.generalNotes,
      };

      const { data, error } = await supabase
        .from("field_reports")
        .insert([reportData])
        .select()
        .single();

      if (error) throw error;

      if (report.workOrderId) {
        const nextStatus: "completed" | "canceled" | "in_progress" =
          report.siteCanceled
            ? "canceled"
            : report.jobCompleted
              ? "completed"
              : "in_progress";

        const { error: statusError } = await supabase
          .from("work_orders")
          .update({ status: nextStatus })
          .eq("id", report.workOrderId);

        if (statusError) throw statusError;
      }

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["field-reports"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["field-reports", variables.jobId] });
      }
      queryClient.invalidateQueries({ queryKey: ["field-team-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ["work-orders", variables.jobId] });
      }
      toast({
        title: "Izveštaj sačuvan",
        description: "Terenski izveštaj je uspešno dodat.",
      });
    },
    onError: (error) => {
      toast({
        title: "Greška",
        description: formatQueryError(error),
        variant: "destructive",
      });
    },
  });

  return {
    reports,
    isLoading,
    isError,
    error,
    createReport,
  };
}
