import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { formatQueryError } from "@/lib/utils";
import {
  URGENT_SITE_MISSING_QUERY_KEY,
  urgentSiteMissingRowMatches,
  type UrgentSiteMissingRow,
} from "@/hooks/use-urgent-site-missing-notifications";

export type SecureInvoiceMissingPartPayload =
  | { jobId: string; position: string; suppressSuccessToast?: boolean }
  | { jobId: string; positions: string[]; suppressSuccessToast?: boolean };

export function useSecureInvoiceMissingPart() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: SecureInvoiceMissingPartPayload) => {
      if ("positions" in payload) {
        const positions = [...new Set(payload.positions.map((p) => p.trim()).filter(Boolean))];
        if (positions.length === 0) throw new Error("Nema pozicija za zakaživanje.");
        const { data, error } = await supabase.rpc("secure_invoice_missing_parts_schedule_installation_batch", {
          p_job_id: payload.jobId,
          p_positions: positions,
        });
        if (error) throw error;
        return typeof data === "string" ? data : null;
      }
      const { data, error } = await supabase.rpc("secure_invoice_missing_part_schedule_installation", {
        p_job_id: payload.jobId,
        p_position: payload.position.trim(),
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },
    onSuccess: (result, variables) => {
      if (result !== null) {
        if ("positions" in variables) {
          const keys = new Set(variables.positions.map((p) => p.trim().toLowerCase()).filter(Boolean));
          queryClient.setQueriesData<UrgentSiteMissingRow[] | undefined>(
            { queryKey: URGENT_SITE_MISSING_QUERY_KEY },
            (old) =>
              old?.filter((row) => {
                if (row.jobId !== variables.jobId) return true;
                const k = (row.position ?? "").trim().toLowerCase();
                return !keys.has(k);
              }),
          );
        } else {
          queryClient.setQueriesData<UrgentSiteMissingRow[] | undefined>(
            { queryKey: URGENT_SITE_MISSING_QUERY_KEY },
            (old) => old?.filter((row) => !urgentSiteMissingRowMatches(row, variables.jobId, variables.position)),
          );
        }
      }

      void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      if (!variables.suppressSuccessToast) {
        if (result === null) {
          toast({
            title: "Ugradnja još nije zakazana",
            description:
              "Postoje još druge hitne pozicije sa predračuna za isti posao. RN dopune se kreira kada budu spremne sve.",
          });
        } else {
          toast({
            title: "Zakažena do-ugradnja",
            description:
              "positions" in variables
                ? "Kreiran je jedan nalog ugradnje na čekanju za sve izabrane pozicije."
                : "Kreiran je novi nalog ugradnje na čekanju za dispečera.",
          });
        }
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
