import { Link } from "react-router-dom";
import { Clock, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import type { StaleJobSlaRow } from "@/lib/job-sla-stale";
import { cn } from "@/lib/utils";

type Props = {
  rows: StaleJobSlaRow[];
  thresholdDays: number;
  withBottomMargin?: boolean;
};

export function DashboardSlaStaleJobsAlert({ rows, thresholdDays, withBottomMargin = true }: Props) {
  if (rows.length === 0) return null;

  const highCount = rows.filter((r) => r.priority === "high").length;

  return (
    <Alert
      className={cn(
        "border-destructive/35 bg-destructive/[0.04] text-foreground dark:border-destructive/30 dark:bg-destructive/[0.06]",
        withBottomMargin && "mb-4",
      )}
    >
      <Clock className="h-4 w-4 text-destructive" />
      <AlertTitle className="text-foreground">SLA — zastoj u statusu posla</AlertTitle>
      <AlertDescription className="mt-2 space-y-3 text-sm text-muted-foreground">
        <p className="text-foreground/85">
          {rows.length === 1
            ? "Jedan posao je u istom statusu duže od praga"
            : `${rows.length} poslova su u istom statusu duže od praga`}{" "}
          ({thresholdDays} {thresholdDays === 1 ? "dan" : "dana"}).
          {highCount > 0 ? (
            <span className="text-destructive">
              {" "}
              {highCount === 1 ? "Jedan" : `${highCount}`} sa dužim zastojem (≥ {thresholdDays * 2} dana).
            </span>
          ) : null}{" "}
          Promenite status posla ili zaključajte ručni status ako je namerno.
        </p>
        <ul className="space-y-1.5 max-h-[min(320px,40vh)] overflow-y-auto pr-1">
          {rows.map((r) => (
            <li
              key={r.jobId}
              className={cn(
                "flex flex-wrap items-start justify-between gap-2 rounded-md border px-2.5 py-2 shadow-sm transition-colors",
                r.priority === "high"
                  ? "border-destructive/55 bg-destructive/10 hover:bg-destructive/15"
                  : "border-destructive/25 bg-background/85 hover:border-destructive/40 hover:bg-background dark:bg-background/40 dark:hover:bg-background/55",
              )}
            >
              <div className="min-w-0 space-y-0.5">
                <div className="font-medium text-foreground">
                  {r.jobNumber}
                  <span className="font-normal text-muted-foreground"> — {r.customerName}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/90">{r.statusLabel}</span>
                  {" · "}
                  {r.daysInStatus} {r.daysInStatus === 1 ? "dan" : "dana"} bez promene
                  {" · od "}
                  {formatDateByAppLanguage(r.statusChangedAt)}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1" asChild>
                <Link to={`/jobs/${r.jobId}`}>
                  Posao
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
