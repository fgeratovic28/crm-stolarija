import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { UrgentSiteMissingRow } from "@/hooks/use-urgent-site-missing-notifications";
import type { SecureInvoiceMissingPartPayload } from "@/hooks/use-secure-invoice-missing-part";
import {
  INVOICE_MISSING_PROCUREMENT_PHASE_LABEL,
  invoiceMissingProcurementUiPhase,
  invoiceMissingShowProductionButton,
} from "@/lib/invoice-missing-procurement-phase";

export type DashboardUrgentPredracunAlertProps = {
  rows: UrgentSiteMissingRow[];
  hasAccess: (module: string) => boolean;
  canSecureInvoiceMissingPart: boolean;
  canConfirmInvoiceMissingProduction: boolean;
  actionPending: boolean;
  onSecurePart: (args: SecureInvoiceMissingPartPayload) => void | Promise<void>;
  onConfirmProduction: (args: {
    jobId: string;
    position: string;
    suppressSuccessToast?: boolean;
  }) => void | Promise<void>;
  onOpenProslediNabavku: (args: { jobId: string; position: string }) => void;
  /** Kada je false, Alert nema donju marginu (u modalu). */
  withBottomMargin?: boolean;
};

type RowUi = {
  magacinEnabled: boolean;
  nabavkuEnabled: boolean;
  procurementOrdered: boolean;
  procurementBusy: boolean;
  procurementPhaseLabel: string | null;
  followupSecured: boolean;
  showProductionButton: boolean;
  /** Čekiranje za listu (magacin i/ili nabavka). */
  showRowCheckbox: boolean;
};

function computeRowUi(
  row: UrgentSiteMissingRow,
  actionPending: boolean,
  canSecureInvoiceMissingPart: boolean,
  canConfirmInvoiceMissingProduction: boolean,
): RowUi {
  const triage = row.procurementTriage;
  const st = triage?.adHocStatus ?? "";
  const ds = triage?.shortageDeliveryStatus ?? "";
  const legacyNeedsOrder = !!triage?.adHocItemId && st === "needs_order";
  const legacyOrdered = !!triage?.adHocItemId && st === "ordered";
  const legacyReceived = !!triage?.adHocItemId && st === "received";
  const newPath = !!triage && !triage.adHocItemId;
  const newInProcurement =
    newPath && !!ds && ds !== "materials_received" && ds !== "received_with_issues";
  const newAwaitingProduction =
    newPath && ds === "materials_received" && Boolean(triage?.awaitingProduction);
  const procurementOrdered = legacyOrdered || (newPath && ds === "waiting_for_delivery");
  const procurementBusy =
    !!triage &&
    !row.installationFollowupSecured &&
    (legacyNeedsOrder || legacyOrdered || legacyReceived || newInProcurement || newAwaitingProduction);
  const phase = invoiceMissingProcurementUiPhase(triage);
  const procurementPhaseLabel =
    phase != null
      ? INVOICE_MISSING_PROCUREMENT_PHASE_LABEL[phase]
      : legacyNeedsOrder
        ? "Nabavka — zahtev"
        : legacyOrdered
          ? "U nabavci"
          : legacyReceived && triage?.awaitingProduction
            ? "Čeka proizvodnju"
            : legacyReceived
              ? "Primljeno"
              : null;
  const followupSecured = row.installationFollowupSecured === true;

  const magacinEnabled =
    canSecureInvoiceMissingPart &&
    Boolean(row.jobId && row.position) &&
    !actionPending &&
    !procurementBusy &&
    !followupSecured;

  const nabavkuEnabled =
    canSecureInvoiceMissingPart &&
    Boolean(row.jobId && row.position) &&
    !procurementBusy &&
    !followupSecured;

  const showProductionButton = invoiceMissingShowProductionButton(
    canConfirmInvoiceMissingProduction,
    row.jobId,
    row.position,
    triage,
  );

  const showRowCheckbox =
    Boolean(row.jobId && row.position) && (magacinEnabled || nabavkuEnabled);

  return {
    magacinEnabled,
    nabavkuEnabled,
    procurementOrdered,
    procurementBusy,
    procurementPhaseLabel,
    followupSecured,
    showProductionButton,
    showRowCheckbox,
  };
}

type JobGroup = {
  key: string;
  jobId: string | null;
  jobNumber: string | null;
  rows: UrgentSiteMissingRow[];
};

export function DashboardUrgentPredracunAlert({
  rows,
  hasAccess,
  canSecureInvoiceMissingPart,
  canConfirmInvoiceMissingProduction,
  actionPending,
  onSecurePart,
  onConfirmProduction,
  onOpenProslediNabavku,
  withBottomMargin = true,
}: DashboardUrgentPredracunAlertProps) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const valid = new Set(rows.map((r) => r.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => valid.has(id))));
  }, [rows]);

  const jobGroups = useMemo(() => {
    const map = new Map<string, UrgentSiteMissingRow[]>();
    for (const r of rows) {
      const key = r.jobId ?? `_no_job_${r.id}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].map(([key, g]): JobGroup => {
      const sorted = [...g].sort((a, b) => {
        const pa = (a.position ?? "").toLowerCase();
        const pb = (b.position ?? "").toLowerCase();
        return pa.localeCompare(pb, "sr");
      });
      return {
        key,
        jobId: sorted[0]?.jobId ?? null,
        jobNumber: sorted[0]?.jobNumber ?? null,
        rows: sorted,
      };
    });
  }, [rows]);

  if (rows.length === 0) return null;

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllMagacinInGroup = (groupRows: UrgentSiteMissingRow[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of groupRows) {
        const ui = computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction);
        if (ui.magacinEnabled) next.add(r.id);
      }
      return next;
    });
  };

  const clearGroupSelection = (groupRows: UrgentSiteMissingRow[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of groupRows) next.delete(r.id);
      return next;
    });
  };

  const runBulkMagacin = async (groupRows: UrgentSiteMissingRow[]) => {
    const eligible = groupRows.filter((r) => {
      if (!selectedIds.has(r.id)) return false;
      const ui = computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction);
      return ui.magacinEnabled;
    });
    if (eligible.length === 0) return;
    const jobId = eligible[0]!.jobId!;
    if (!eligible.every((r) => r.jobId === jobId)) return;
    if (eligible.length === 1) {
      const r = eligible[0]!;
      await onSecurePart({ jobId, position: r.position! });
      return;
    }
    await onSecurePart({
      jobId,
      positions: eligible.map((r) => r.position!),
    });
  };

  const selectAllProductionInGroup = (groupRows: UrgentSiteMissingRow[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of groupRows) {
        const ui = computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction);
        if (ui.showProductionButton) next.add(r.id);
      }
      return next;
    });
  };

  const runBulkProductionConfirm = async (groupRows: UrgentSiteMissingRow[]) => {
    const eligible = groupRows.filter((r) => {
      if (!selectedIds.has(r.id)) return false;
      const ui = computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction);
      return ui.showProductionButton;
    });
    if (eligible.length === 0) return;
    const jobId = eligible[0]!.jobId!;
    if (!eligible.every((r) => r.jobId === jobId)) return;
    for (let i = 0; i < eligible.length; i++) {
      const r = eligible[i]!;
      await onConfirmProduction({
        jobId,
        position: r.position!,
        suppressSuccessToast: i < eligible.length - 1,
      });
    }
  };

  const selectedSingleForNabavku = useMemo(() => {
    if (selectedIds.size !== 1) return null;
    const id = [...selectedIds][0];
    const row = rows.find((r) => r.id === id);
    if (!row?.jobId || !row.position) return null;
    const ui = computeRowUi(row, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction);
    if (!ui.nabavkuEnabled) return null;
    return row;
  }, [rows, selectedIds, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction]);

  return (
    <Alert
      variant="destructive"
      className={
        withBottomMargin
          ? "mb-4 min-w-0 max-w-full border-destructive/70 bg-destructive/10"
          : "mb-0 min-w-0 max-w-full border-destructive/70 bg-destructive/10"
      }
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="break-words pr-1">HITNO: nedostatak sa ugradnje (predračun)</AlertTitle>
      <AlertDescription className="mt-2 min-w-0 space-y-3">
        <p className="break-words text-sm">
          Montaža je prijavila stavke sa predračuna koje nedostaju na terenu — za svaki posao izaberite pozicije u
          listi, zatim <span className="font-medium">magacin</span> (jedan RN ugradnje za sve izabrane pozicije) ili{" "}
          <span className="font-medium">nabavku</span> (jedna po jedna forma). Posle prijema / proizvodnje, sledeći
          koraci takođe spajaju pozicije na isti pending RN ugradnje dok je na čekanju.
        </p>
        <ul className="list-none space-y-3 break-words text-sm">
          {jobGroups.map((group) => {
            const n = group.rows.length;
            const anyTriage = group.rows.some((r) => r.procurementTriage && r.jobId);
            const selectedInGroup = group.rows.filter((r) => selectedIds.has(r.id)).length;
            const magacinPickable = group.rows.filter((r) =>
              computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction)
                .magacinEnabled,
            ).length;
            const productionPickable = group.rows.filter((r) =>
              computeRowUi(r, actionPending, canSecureInvoiceMissingPart, canConfirmInvoiceMissingProduction)
                .showProductionButton,
            ).length;

            return (
              <li
                key={group.key}
                className="flex flex-col gap-3 rounded-md border border-destructive/25 bg-background/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 font-medium leading-snug">
                    {group.jobNumber ? `Posao ${group.jobNumber}` : "Posao (nepoznat broj)"}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      · {n} {n === 1 ? "pozicija" : "pozicije"}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {hasAccess("jobs") && group.jobId ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() => navigate(`/jobs/${group.jobId}`)}
                      >
                        Otvori posao
                      </Button>
                    ) : null}
                    {anyTriage && group.jobId ? (
                      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" asChild>
                        <Link to={`/jobs/${group.jobId}?tab=materials`}>Idi na nabavku</Link>
                      </Button>
                    ) : null}
                  </div>
                </div>

                <ul className="space-y-2 rounded-md border border-border/80 bg-muted/20 p-2">
                  {group.rows.map((row) => {
                    const ui = computeRowUi(
                      row,
                      actionPending,
                      canSecureInvoiceMissingPart,
                      canConfirmInvoiceMissingProduction,
                    );
                    return (
                      <li
                        key={row.id}
                        className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/80 px-2 py-2 sm:flex-row sm:items-start sm:gap-3"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          {ui.showRowCheckbox ? (
                            <Checkbox
                              id={`urgent-pick-${row.id}`}
                              className="mt-0.5"
                              checked={selectedIds.has(row.id)}
                              disabled={actionPending}
                              onCheckedChange={(c) => toggleSelected(row.id, c === true)}
                              aria-label={`Izaberi poziciju ${row.position ?? ""}`}
                            />
                          ) : (
                            <span className="mt-0.5 w-4 shrink-0" aria-hidden />
                          )}
                          <div className="min-w-0 flex-1">
                            {ui.showRowCheckbox ? (
                              <label htmlFor={`urgent-pick-${row.id}`} className="block cursor-pointer">
                                <span className="font-mono text-sm font-semibold text-foreground">
                                  {row.position ?? "—"}
                                </span>
                                <span className="ml-2 inline-flex flex-wrap items-center gap-1">
                                  {ui.procurementPhaseLabel && !ui.followupSecured ? (
                                    <Badge
                                      variant="outline"
                                      className={
                                        ui.showProductionButton
                                          ? "border-violet-600/50 bg-violet-500/15 text-violet-950 dark:text-violet-100"
                                          : ui.procurementOrdered
                                            ? "border-orange-500/55 bg-orange-500/12 text-orange-950 dark:text-orange-50"
                                            : "border-amber-600/50 bg-amber-500/15 text-amber-950 dark:text-amber-50"
                                      }
                                    >
                                      {ui.procurementPhaseLabel}
                                    </Badge>
                                  ) : null}
                                  {ui.followupSecured ? (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-600/50 bg-emerald-500/12 text-emerald-950 dark:text-emerald-50"
                                    >
                                      Magacin — dopuna zakazana
                                    </Badge>
                                  ) : null}
                                </span>
                              </label>
                            ) : (
                              <div className="block">
                                <span className="font-mono text-sm font-semibold text-foreground">
                                  {row.position ?? "—"}
                                </span>
                                <span className="ml-2 inline-flex flex-wrap items-center gap-1">
                                  {ui.procurementPhaseLabel && !ui.followupSecured ? (
                                    <Badge
                                      variant="outline"
                                      className={
                                        ui.showProductionButton
                                          ? "border-violet-600/50 bg-violet-500/15 text-violet-950 dark:text-violet-100"
                                          : ui.procurementOrdered
                                            ? "border-orange-500/55 bg-orange-500/12 text-orange-950 dark:text-orange-50"
                                            : "border-amber-600/50 bg-amber-500/15 text-amber-950 dark:text-amber-50"
                                      }
                                    >
                                      {ui.procurementPhaseLabel}
                                    </Badge>
                                  ) : null}
                                  {ui.followupSecured ? (
                                    <Badge
                                      variant="outline"
                                      className="border-emerald-600/50 bg-emerald-500/12 text-emerald-950 dark:text-emerald-50"
                                    >
                                      Magacin — dopuna zakazana
                                    </Badge>
                                  ) : null}
                                </span>
                              </div>
                            )}
                            {row.description ? (
                              <p className="mt-0.5 break-words text-xs text-muted-foreground">{row.description}</p>
                            ) : null}
                          </div>
                        </div>
                        {ui.showProductionButton ? (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            className="h-auto shrink-0 bg-violet-700 py-2 text-left text-white hover:bg-violet-700/90 dark:bg-violet-600 sm:max-w-[14rem]"
                            disabled={actionPending}
                            onClick={() =>
                              onConfirmProduction({
                                jobId: row.jobId!,
                                position: row.position!,
                              })
                            }
                          >
                            Proizvedeno — Zakaži ugradnju
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                <div className="flex flex-col gap-2 border-t border-destructive/15 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <p className="text-[11px] text-muted-foreground sm:mr-auto">
                    Izabrano u ovom poslu: {selectedInGroup}
                    {magacinPickable > 0 ? ` · može magacin: ${magacinPickable}` : null}
                    {productionPickable > 0 ? ` · čeka proizvodnju: ${productionPickable}` : null}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={actionPending || magacinPickable === 0}
                      onClick={() => selectAllMagacinInGroup(group.rows)}
                    >
                      Izaberi sve za magacin
                    </Button>
                    {productionPickable > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={actionPending}
                        onClick={() => selectAllProductionInGroup(group.rows)}
                      >
                        Izaberi sve za proizvodnju
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={actionPending || selectedInGroup === 0}
                      onClick={() => clearGroupSelection(group.rows)}
                    >
                      Poništi izbor
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={
                        actionPending ||
                        !group.rows.some((r) => {
                          if (!selectedIds.has(r.id)) return false;
                          const u = computeRowUi(
                            r,
                            actionPending,
                            canSecureInvoiceMissingPart,
                            canConfirmInvoiceMissingProduction,
                          );
                          return u.magacinEnabled;
                        })
                      }
                      title="Zakaže do-ugradnju za sve izabrane pozicije u ovom poslu koje još mogu u magacin (bez aktivne nabavke)."
                      onClick={() => void runBulkMagacin(group.rows)}
                    >
                      Zaboravljeno u magacinu ({selectedInGroup ? "izabrane u poslu" : "—"})
                    </Button>
                    {productionPickable > 0 ? (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 border-violet-700 bg-violet-700 text-xs text-white hover:bg-violet-700/90 dark:bg-violet-600"
                        disabled={
                          actionPending ||
                          !group.rows.some((r) => {
                            if (!selectedIds.has(r.id)) return false;
                            const u = computeRowUi(
                              r,
                              actionPending,
                              canSecureInvoiceMissingPart,
                              canConfirmInvoiceMissingProduction,
                            );
                            return u.showProductionButton;
                          })
                        }
                        title="Potvrđuje proizvodnju i zakačuje jedan nalog ugradnje za sve izabrane pozicije koje čekaju ovaj korak."
                        onClick={() => void runBulkProductionConfirm(group.rows)}
                      >
                        Proizvedeno — sve izabrane
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2 rounded-md border border-destructive/20 bg-background/40 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            Za nabavku: izaberite <span className="font-medium text-foreground">tačno jednu</span> poziciju (jedan
            čekirani red bilo kog posla), pa otvorite formu.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 shrink-0 text-xs"
            disabled={actionPending || !selectedSingleForNabavku || selectedIds.size !== 1}
            title={
              selectedIds.size !== 1
                ? "Izaberite tačno jednu poziciju (jedan ček) za formu nabavke."
                : !selectedSingleForNabavku
                  ? "Izabrana pozicija ne može u nabavku (već u toku ili završeno iz magacina)."
                  : undefined
            }
            onClick={() => {
              const r = selectedSingleForNabavku;
              if (!r?.jobId || !r.position) return;
              onOpenProslediNabavku({ jobId: r.jobId, position: r.position });
            }}
          >
            Prosledi u nabavku (izabrana pozicija)
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
