import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, MapPin, XCircle, AlertTriangle, FileText, Plus, Info } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldReportDetailModal } from "@/components/modals/FieldReportDetailModal";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import { ImageLightbox } from "@/components/shared/ImageLightbox";
import { JobCustomerLink } from "@/components/shared/JobCustomerLink";
import type { JobDetailsReturnState } from "@/lib/job-details-return";
import { useRole } from "@/contexts/RoleContext";
import { useTeams } from "@/hooks/use-teams";
import type { FieldReport } from "@/types";
import { labelWorkOrderType } from "@/lib/activity-labels";
import {
  displayFieldReportMissingItem,
  formatAssignedTeamLabel,
} from "@/lib/field-report-mappers";
import { REPORT_FLOW_OPTIONS, type ReportFlowChoice } from "@/lib/field-report-flow-options";

export type FieldReportJobMeta = {
  jobNumber: string;
  customerName: string;
};

export function FieldReportsTab({
  reports,
  totalCount,
  jobMeta,
  jobListReturn,
}: {
  reports: FieldReport[];
  /** Ukupan broj posle filtera (globalna strana); podrazumevano `reports.length`. */
  totalCount?: number;
  jobMeta?: Map<string, FieldReportJobMeta>;
  /** Sa globalne strane izveštaja — dugme Nazad na kartici posla. */
  jobListReturn?: JobDetailsReturnState;
}) {
  const { id: currentJobId } = useParams();
  const { canPerformAction } = useRole();
  const { teams } = useTeams();
  const teamNameById = useMemo(
    () => new Map((teams ?? []).map((t) => [t.id, t.name])),
    [teams],
  );
  const displayCount = totalCount ?? reports.length;
  const [selectedReport, setSelectedReport] = useState<FieldReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draftReportFlow, setDraftReportFlow] = useState<ReportFlowChoice>("standard");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const canAdd =
    canPerformAction("add_field_report") || canPerformAction("add_mounting_report");

  const AddReportDropdown = ({ variant = "default" as "default" | "outline" }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant}>
          <Plus className="w-4 h-4 mr-1 shrink-0" />
          Dodaj izveštaj
          <ChevronDown className="w-4 h-4 ml-1 opacity-70 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(calc(100vw-2rem),22rem)] max-h-[min(70vh,24rem)] overflow-y-auto">
        {REPORT_FLOW_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            className="flex flex-col items-stretch gap-0.5 py-2 cursor-pointer"
            onSelect={() => {
              setDraftReportFlow(o.value);
              setCreateOpen(true);
            }}
          >
            <span className="text-sm font-medium text-foreground">{o.label}</span>
            <span className="text-[11px] text-muted-foreground leading-snug">{o.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      <SectionHeader
        title="Terenski / Montažni izveštaji"
        subtitle={`${displayCount} izveštaj${displayCount === 1 ? "" : "a"}`}
        icon={FileText}
        actions={canAdd ? <AddReportDropdown /> : undefined}
      />
      {reports.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nema terenskih izveštaja"
          description="Još uvek nema izveštaja sa terena za ovaj posao ili filtere."
          actionsSlot={canAdd ? <AddReportDropdown variant="outline" /> : undefined}
        />
      ) : (
        <div className="space-y-4">
          {reports.map((r) => {
            const showJobLink = !currentJobId && !!r.jobId;
            const meta = r.jobId ? jobMeta?.get(r.jobId) : undefined;
            const jobNumber = meta?.jobNumber ?? r.job?.jobNumber ?? "Posao";
            const customerName = meta?.customerName ?? r.job?.customer?.fullName;
            const teamLabel = formatAssignedTeamLabel(r.teamId, teamNameById);
            const showTeam = !!(r.workOrderId || r.workOrderType);
            return (
              <div key={r.id} className="bg-card rounded-xl border border-border p-4 sm:p-5 space-y-4 hover:shadow-sm transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <MapPin className="w-5 h-5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-foreground text-sm">{r.address}</p>
                        {r.workOrderType && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                            {labelWorkOrderType(r.workOrderType)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {r.arrivalDate && <span>Dolazak: {new Date(r.arrivalDate).toLocaleString("sr-RS")}</span>}
                        {showTeam && (
                          <>
                            {r.arrivalDate && <span aria-hidden>·</span>}
                            <span>
                              Tim:{" "}
                              <span className="font-medium text-foreground">{teamLabel}</span>
                            </span>
                          </>
                        )}
                        {showJobLink && (
                          <>
                            {(r.arrivalDate || showTeam) && <span aria-hidden>·</span>}
                            <JobCustomerLink
                            jobId={r.jobId}
                            jobNumber={jobNumber}
                            customerName={customerName}
                            returnState={jobListReturn}
                          />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end shrink-0">
                    <GenericBadge label={r.arrived ? "Stigao" : "Nije stigao"} variant={r.arrived ? "success" : "muted"} />
                    <GenericBadge label={r.jobCompleted ? "Završeno" : "Nezavršeno"} variant={r.jobCompleted ? "success" : "warning"} />
                    <GenericBadge label={r.everythingOk ? "Sve OK" : "Problemi"} variant={r.everythingOk ? "success" : "danger"} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        setSelectedReport(r);
                        setDetailOpen(true);
                      }}
                    >
                      <Info className="w-4 h-4 mr-1" />
                      Detalji
                    </Button>
                  </div>
                </div>

                {r.siteCanceled && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg p-3">
                    <XCircle className="w-4 h-4 shrink-0" /> Teren otkazan{r.cancelReason ? `: ${r.cancelReason}` : ""}
                  </div>
                )}

                {r.issueDescription && (
                  <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                      <AlertTriangle className="w-4 h-4" /> Pronađeni problemi
                    </div>
                    <p className="text-sm text-foreground leading-relaxed line-clamp-2">{r.issueDescription}</p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {r.measurements && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Mere</p>
                      <p className="text-sm text-foreground">{r.measurements}</p>
                    </div>
                  )}
                  {r.generalNotes && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Napomene</p>
                      <p className="text-sm text-foreground line-clamp-2">{r.generalNotes}</p>
                    </div>
                  )}
                </div>

                {r.missingItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Nedostajući delovi</p>
                    <div className="flex flex-wrap gap-1.5">
                      {r.missingItems.map((item, i) => (
                        <span key={i} className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">
                          {displayFieldReportMissingItem(item)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {r.images.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Fotografije ({r.images.length})</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {r.images.map((img, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setLightboxSrc(img)}
                          className="aspect-square bg-muted rounded-lg overflow-hidden border border-border cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring p-0"
                        >
                          <img
                            src={img}
                            alt=""
                            className="w-full h-full object-cover pointer-events-none"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FieldReportDetailModal report={selectedReport} open={detailOpen} onOpenChange={setDetailOpen} />
      <NewFieldReportModal
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setDraftReportFlow("standard");
        }}
        initialReportFlow={draftReportFlow}
      />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
