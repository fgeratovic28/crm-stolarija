import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ExternalLink, Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useSalesDashboardAlerts,
  useUpsertSalesAlertNote,
  type SalesFollowupWorkOrderAlert,
  type SalesAddonSiteQuoteAlert,
} from "@/hooks/use-sales-dashboard-alerts";
import type { WorkOrderType } from "@/types";
import { labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import { cn } from "@/lib/utils";
import { AddonSiteQuoteAlertModal } from "@/components/modals/AddonSiteQuoteAlertModal";

function SalesAlertNoteField({ alertKey, initialNote }: { alertKey: string; initialNote: string }) {
  const [val, setVal] = useState(initialNote);
  useEffect(() => {
    setVal(initialNote);
  }, [alertKey, initialNote]);

  const upsert = useUpsertSalesAlertNote();

  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <Input
        className="text-sm flex-1"
        placeholder="Beleška (npr. poslao ponudu klijentu)…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        disabled={upsert.isPending}
        onClick={() => upsert.mutate({ alertKey, note: val })}
      >
        {upsert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sačuvaj"}
      </Button>
    </div>
  );
}

function openJob(navigate: ReturnType<typeof useNavigate>, jobId: string) {
  navigate(`/jobs/${jobId}`);
}

export function SalesAlertsWidget() {
  const navigate = useNavigate();
  const q = useSalesDashboardAlerts(true);
  const [addonModalAlert, setAddonModalAlert] = useState<SalesAddonSiteQuoteAlert | null>(null);
  const [addonModalOpen, setAddonModalOpen] = useState(false);

  if (q.isLoading) {
    return (
      <Card className="mb-4 border-destructive/25 bg-destructive/[0.03]">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Upozorenja — učitavanje…</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (q.isError) {
    return (
      <Card className="mb-4 border-destructive/40 bg-destructive/5">
        <CardContent className="py-3 text-sm text-destructive">
          {q.error instanceof Error ? q.error.message : "Upozorenja nisu učitana."}
        </CardContent>
      </Card>
    );
  }

  const { followups, addonSiteQuotes, noteByKey } = q.data!;
  const total = followups.length + addonSiteQuotes.length;
  if (total === 0) return null;

  const rowClass =
    "rounded-lg border border-destructive/25 bg-background/85 p-3 space-y-2 text-sm shadow-sm transition-colors hover:border-destructive/40 hover:bg-background dark:bg-background/40 dark:hover:bg-background/55";

  return (
    <>
      <AddonSiteQuoteAlertModal
        alert={addonModalAlert}
        open={addonModalOpen}
        onOpenChange={(o) => {
          setAddonModalOpen(o);
          if (!o) setAddonModalAlert(null);
        }}
        onCreatedNavigate={(newJobId) => navigate(`/jobs/${newJobId}`)}
      />
    <Card className="mb-4 border-destructive/40 bg-destructive/[0.04] dark:border-destructive/30 dark:bg-destructive/[0.06]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          Upozorenja
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal leading-snug">
          Prateći nalozi ugradnje bez montaže i upiti sa terena za dodatne radove (novi pod-posao).
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {addonSiteQuotes.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
              Upit sa terena (dodatni radovi)
            </p>
            <ul className="space-y-2">
              {addonSiteQuotes.map((a: SalesAddonSiteQuoteAlert) => (
                <li
                  key={a.alertId}
                  className={cn(
                    rowClass,
                    "border-destructive/30 bg-destructive/[0.04] dark:border-destructive/25 dark:bg-destructive/[0.06]",
                  )}
                >
                  <p className="text-sm leading-snug text-foreground">
                    <span className="font-medium text-destructive">
                      Upit sa terena za dodatne radove:
                    </span>{" "}
                    {a.workerText}{" "}
                    <span className="text-muted-foreground">(Posao {a.jobNumber})</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        setAddonModalAlert(a);
                        setAddonModalOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Kreiraj novi posao
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {followups.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Prateći nalozi ugradnje (čeka montažu)
            </p>
            <ul className="space-y-2">
              {followups.map((w: SalesFollowupWorkOrderAlert) => (
                <li key={w.alertKey} className={cn(rowClass)}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div>
                        <span className="font-medium">{w.jobNumber}</span>
                        <span className="text-muted-foreground"> — {w.customerName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {labelWorkOrderType(w.woType as WorkOrderType)} ·{" "}
                        {w.woDate || "—"} · {labelWorkOrderStatus(w.woStatus)}
                      </div>
                      <p className="text-xs leading-snug text-foreground/90 line-clamp-3">{w.woDescription}</p>
                      {w.workerReportContext.trim() ? (
                        <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] leading-snug text-foreground/90">
                          {w.workerReportContext.trim()}
                        </pre>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1"
                      onClick={() => openJob(navigate, w.jobId)}
                    >
                      Posao
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <SalesAlertNoteField
                    alertKey={w.alertKey}
                    initialNote={noteByKey[w.alertKey]?.note ?? ""}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
    </>
  );
}
