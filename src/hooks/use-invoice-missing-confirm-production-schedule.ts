import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { formatQueryError } from "@/lib/utils";
import {
  URGENT_SITE_MISSING_QUERY_KEY,
  urgentSiteMissingRowMatches,
  type UrgentSiteMissingRow,
} from "@/hooks/use-urgent-site-missing-notifications";

export function useInvoiceMissingConfirmProductionSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { jobId: string; position: string; suppressSuccessToast?: boolean }) => {
      const { data, error } = await supabase.rpc("invoice_missing_confirm_production_schedule_installation", {
        p_job_id: payload.jobId,
        p_position: payload.position.trim(),
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData<UrgentSiteMissingRow[] | undefined>(
        { queryKey: URGENT_SITE_MISSING_QUERY_KEY },
        (old) => old?.filter((row) => !urgentSiteMissingRowMatches(row, variables.jobId, variables.position)),
      );

      void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      if (!variables.suppressSuccessToast) {
        toast({
          title: "Ugradnja zakažena",
          description: "Kreiran je nalog ugradnje na čekanju; hitni alert je zatvoren.",
        });
      }
    },
    onError: (e) => {
      toast({
        title: "Greška",
        description: formatQueryError(e),
        variant: "destructive",
      });
    },
  });
}
