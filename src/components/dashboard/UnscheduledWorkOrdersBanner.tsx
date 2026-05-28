import { useState } from "react";
import { Link } from "react-router-dom";
import { Users, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { UnscheduledDashboardWorkOrderRow } from "@/hooks/use-unscheduled-work-orders-dashboard";
import { labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import { JOB_STATUS_CONFIG, type WorkOrderType } from "@/types";

function UnscheduledList({
  title,
  rows,
  showScheduledDate,
}: {
  title: string;
  rows: UnscheduledDashboardWorkOrderRow[];
  showScheduledDate?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{title}</p>
      <ul className="space-y-1.5 text-sm">
        {rows.map((r) => (
          <li
            key={r.workOrderId}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-destructive/25 bg-background/85 px-2 py-1.5 shadow-sm transition-colors hover:border-destructive/40 hover:bg-background dark:bg-background/40 dark:hover:bg-background/55"
          >
            <div className="min-w-0 space-y-0.5">
              <div>
                <span className="font-medium">{r.jobNumber}</span>
                <span className="text-muted-foreground"> — {r.customerName}</span>
              </div>
              <div className="text-xs text-foreground/85">
                <span className="font-medium text-foreground">{labelWorkOrderType(r.woType as WorkOrderType)}</span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-muted-foreground">{labelWorkOrderStatus(r.woStatus)}</span>
                {showScheduledDate && r.scheduledDate ? (
                  <>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-foreground">Termin: {r.scheduledDate}</span>
                  </>
                ) : null}
              </div>
              {r.woDescription.trim() ? (
                <p className="text-xs leading-snug text-foreground line-clamp-2">{r.woDescription.trim()}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1 border-destructive/25 hover:border-destructive/45"
              asChild
            >
              <Link to={`/jobs/${r.jobId}`}>
                Posao
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Props = {
  measurement: UnscheduledDashboardWorkOrderRow[];
  installation: UnscheduledDashboardWorkOrderRow[];
  production: UnscheduledDashboardWorkOrderRow[];
  complaint: UnscheduledDashboardWorkOrderRow[];
  service: UnscheduledDashboardWorkOrderRow[];
  acceptedNeedsMeasurement: UnscheduledDashboardWorkOrderRow[];
  needsInstallationSchedule: UnscheduledDashboardWorkOrderRow[];
};

export function UnscheduledWorkOrdersBanner({
  measurement,
  installation,
  production,
  complaint,
  service,
  acceptedNeedsMeasurement,
  needsInstallationSchedule,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const missingTeamCount =
    measurement.length + installation.length + production.length + complaint.length + service.length;
  const acceptedCount = acceptedNeedsMeasurement.length;
  const installScheduleCount = needsInstallationSchedule.length;
  const total = missingTeamCount + acceptedCount + installScheduleCount;
  if (total === 0) return null;

  const COLLAPSED_LIMIT = 2;
  const collapsed = !expanded && total > COLLAPSED_LIMIT;
  let remaining = collapsed ? COLLAPSED_LIMIT : Number.POSITIVE_INFINITY;
  const pick = (rows: UnscheduledDashboardWorkOrderRow[]) => {
    if (remaining <= 0) return [] as UnscheduledDashboardWorkOrderRow[];
    if (!Number.isFinite(remaining)) return rows;
    const out = rows.slice(0, remaining);
    remaining -= out.length;
    return out;
  };
  const hiddenCount = collapsed ? Math.max(0, total - COLLAPSED_LIMIT) : 0;

  return (
    <Alert className="mb-4 border-destructive/20 bg-destructive/[0.03] text-muted-foreground dark:border-destructive/20 dark:bg-destructive/[0.04]">
      <Users className="h-4 w-4 text-destructive" />
      <AlertTitle className="text-foreground/90">Neraspoređeni radni nalozi</AlertTitle>
      <AlertDescription className="mt-2 space-y-4">
        {missingTeamCount > 0 ? (
          <p className="text-sm text-foreground">
            {missingTeamCount === 1
              ? "Jedan nalog nema dodeljen operativni tim."
              : `${missingTeamCount} naloga nemaju dodeljen operativni tim.`}{" "}
            <span className="text-muted-foreground">
              Za merenje koristite „Zakaži merenje“, za ugradnju „Zakaži ugradnju“ na kartici posla (tim i termin u
              istom koraku). Ostale tipove naloga dodelite na kartici „Nalozi“.
            </span>
          </p>
        ) : null}
        {acceptedCount > 0 ? (
          <p className="text-sm text-foreground">
            {acceptedCount === 1
              ? "Jedan posao (prihvaćen ili u fazi merenja) čeka zakazivanje merenja i dodelu tima na nalogu merenja."
              : `${acceptedCount} poslova (prihvaćeno / merenje) čeka zakazivanje merenja i dodelu tima.`}{" "}
            <span className="text-muted-foreground">Koristite dugme „Zakaži merenje“ na kartici posla.</span>
          </p>
        ) : null}
        {installScheduleCount > 0 ? (
          <p className="text-sm text-foreground">
            {installScheduleCount === 1
              ? "Jedan posao u statusu „Čeka ugradnju“ još nije spreman za montažu (termin na poslu i/ili tim na RN ugradnje)."
              : `${installScheduleCount} poslova u statusu „Čeka ugradnju“ čeka „Zakaži ugradnju“ (termin i tim).`}{" "}
            <span className="text-muted-foreground">Kada su oba urađena, posao nestaje iz ove liste.</span>
          </p>
        ) : null}
        <UnscheduledList title="Prodaja — merenje (bez tima)" rows={pick(measurement)} />
        <UnscheduledList
          title="Ugradnja — RN montaže (bez tima, ostali statusi)"
          rows={pick(installation)}
        />
        <UnscheduledList title="Proizvodnja (bez tima)" rows={pick(production)} />
        <UnscheduledList title="Reklamacija (bez tima)" rows={pick(complaint)} />
        <UnscheduledList title="Servis (bez tima)" rows={pick(service)} />
        <UnscheduledList
          title={`${JOB_STATUS_CONFIG.accepted.label} / merenje — tim i termin`}
          rows={pick(acceptedNeedsMeasurement)}
          showScheduledDate
        />
        <UnscheduledList
          title="Čeka ugradnju — zakaži ugradnju i dodeli tim"
          rows={pick(needsInstallationSchedule)}
          showScheduledDate
        />
        {collapsed ? (
          <div className="pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setExpanded(true)}>
              Prikaži više ({hiddenCount})
            </Button>
          </div>
        ) : expanded && total > COLLAPSED_LIMIT ? (
          <div className="pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Prikaži manje
            </Button>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
