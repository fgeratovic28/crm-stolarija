import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { SalesAddonSiteQuoteAlert } from "@/hooks/use-sales-dashboard-alerts";
import { useCreateChildJobFromAddonSiteQuoteAlert } from "@/hooks/use-sales-dashboard-alerts";
import { formatQueryError } from "@/lib/utils";

type FieldReportRow = {
  id: string;
  measurements?: string | null;
  general_report?: string | null;
  missing_items?: string[] | null;
  additional_needs?: string[] | null;
  work_orders?: {
    work_order_items?: Array<{ description: string; measurements?: string | null }>;
  } | null;
};

function loadFieldReportForAlert(fieldReportId: string) {
  return supabase
    .from("field_reports")
    .select(
      "id, measurements, general_report, missing_items, additional_needs, work_orders!field_reports_work_order_id_fkey ( work_order_items ( description, measurements ) )",
    )
    .eq("id", fieldReportId)
    .maybeSingle();
}

interface AddonSiteQuoteAlertModalProps {
  alert: SalesAddonSiteQuoteAlert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatedNavigate: (newJobId: string) => void;
}

export function AddonSiteQuoteAlertModal({
  alert,
  open,
  onOpenChange,
  onCreatedNavigate,
}: AddonSiteQuoteAlertModalProps) {
  const createChild = useCreateChildJobFromAddonSiteQuoteAlert();

  const frId = alert?.fieldReportId?.trim() ?? "";

  const frQuery = useQuery({
    queryKey: ["addon-site-quote-alert-field-report", frId],
    enabled: open && frId.length > 0,
    queryFn: async () => {
      const { data, error } = await loadFieldReportForAlert(frId);
      if (error) throw error;
      return (data ?? null) as FieldReportRow | null;
    },
  });

  const handleCreate = async () => {
    if (!alert) return;
    try {
      const newId = await createChild.mutateAsync(alert.alertId);
      onOpenChange(false);
      onCreatedNavigate(newId);
    } catch {
      /* toast u mutaciji */
    }
  };

  const woItems = (() => {
    const wo = frQuery.data?.work_orders;
    const woRow = Array.isArray(wo) ? wo[0] : wo;
    const items = woRow?.work_order_items;
    return Array.isArray(items) ? items : [];
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upit sa terena za dodatne radove</DialogTitle>
          <DialogDescription>
            Roditeljski posao <span className="font-medium text-foreground">{alert?.jobNumber ?? "—"}</span>. Kreira se
            novi pod-posao za dodatne radove (ponude i dalji tok na tom poslu).
          </DialogDescription>
        </DialogHeader>

        {alert ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Zahtev / opis (montaža)</p>
              <p className="rounded-md border border-border/80 bg-muted/30 p-3 whitespace-pre-wrap leading-snug">
                {alert.workerText.trim() || "—"}
              </p>
            </div>

            {frId ? (
              frQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Učitavanje izveštaja…
                </div>
              ) : frQuery.isError ? (
                <p className="text-xs text-destructive">{formatQueryError(frQuery.error)}</p>
              ) : frQuery.data ? (
                <div className="space-y-3">
                  {frQuery.data.measurements?.trim() ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Mere (izveštaj)</p>
                      <pre className="rounded-md border border-border/80 bg-muted/30 p-3 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {frQuery.data.measurements.trim()}
                      </pre>
                    </div>
                  ) : null}
                  {woItems.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Stavke naloga sa merama</p>
                      <ul className="space-y-2 max-h-48 overflow-y-auto">
                        {woItems.map((it, idx) => (
                          <li key={idx} className="rounded-md border border-border/60 p-2 text-xs">
                            <span className="font-medium text-foreground">{it.description || "Stavka"}</span>
                            {it.measurements?.trim() ? (
                              <pre className="mt-1 text-muted-foreground whitespace-pre-wrap">{it.measurements.trim()}</pre>
                            ) : (
                              <p className="mt-1 text-muted-foreground italic">Bez unetih mera uz stavku</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {frQuery.data.general_report?.trim() ? (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Napomena</p>
                      <p className="rounded-md border border-border/80 bg-muted/30 p-2 text-xs whitespace-pre-wrap">
                        {frQuery.data.general_report.trim()}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Terenski izveštaj nije pronađen.</p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">Nema vezanog ID izveštaja.</p>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
          <Button type="button" disabled={!alert || createChild.isPending} onClick={() => void handleCreate()}>
            {createChild.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Kreiraj novi posao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
