import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { formatQueryError } from "@/lib/utils";
import {
  URGENT_SITE_MISSING_QUERY_KEY,
  urgentSiteMissingRowMatches,
  type UrgentSiteMissingRow,
} from "@/hooks/use-urgent-site-missing-notifications";

/** JSON za `invoice_missing_send_to_procurement` — vidi `buildInvoiceMissingSendPayload`. */
export type InvoiceMissingSendToProcurementPayload = Record<string, unknown>;

export function useInvoiceMissingSendToProcurement() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: { jobId: string; position: string; payload: InvoiceMissingSendToProcurementPayload }) => {
      const { data, error } = await supabase.rpc("invoice_missing_send_to_procurement", {
        p_job_id: payload.jobId,
        p_position: payload.position.trim(),
        p_payload: payload.payload,
      });
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
    onSuccess: (data, variables) => {
      const materialOrderId = typeof data?.material_order_id === "string" ? data.material_order_id : null;
      const requiresProduction = data?.requires_production === true;
      const orderKind = typeof data?.order_kind === "string" ? data.order_kind : variables.payload.order_kind;
      const legacyAdHocId = typeof data?.ad_hoc_item_id === "string" ? data.ad_hoc_item_id : null;

      if (materialOrderId) {
        queryClient.setQueriesData<UrgentSiteMissingRow[] | undefined>(
          { queryKey: URGENT_SITE_MISSING_QUERY_KEY },
          (old) =>
            old?.map((row) =>
              urgentSiteMissingRowMatches(row, variables.jobId, variables.position)
                ? {
                    ...row,
                    procurementTriage: {
                      materialOrderId,
                      adHocItemId: legacyAdHocId,
                      adHocStatus: legacyAdHocId ? "needs_order" : null,
                      vrstaStavke: orderKind === "sirovine" ? "sirovine_za_proizvodnju" : "gotov_proizvod",
                      shortageDeliveryStatus: "pending",
                      requiresProduction,
                      awaitingProduction: false,
                    },
                  }
                : row,
            ),
        );
      }

      void queryClient.invalidateQueries({ queryKey: URGENT_SITE_MISSING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["material-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["procurement-ad-hoc-items"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast({
        title: "Prosleđeno u nabavku",
        description:
          "Kreirana je Porudžbina po nedostatku (hitno sa ugradnje); alert ostaje dok stavka ne stigne u magacin.",
      });
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
