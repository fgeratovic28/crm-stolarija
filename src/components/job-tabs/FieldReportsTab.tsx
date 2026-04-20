import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, CheckCircle, XCircle, AlertTriangle, FileText, Plus } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { Button } from "@/components/ui/button";
import { FieldReportDetailModal } from "@/components/modals/FieldReportDetailModal";
import { NewFieldReportModal } from "@/components/modals/NewFieldReportModal";
import { ImageLightbox } from "@/components/shared/ImageLightbox";
import { useRole } from "@/contexts/RoleContext";
import type { FieldReport } from "@/types";
import { labelWorkOrderType } from "@/lib/activity-labels";

export function FieldReportsTab({ reports }: { reports: FieldReport[] }) {
  const navigate = useNavigate();
  const { canPerformAction } = useRole();
  const [selectedReport, setSelectedReport] = useState<FieldReport | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const canAdd =
    canPerformAction("add_field_report") || canPerformAction("add_mounting_report");

  return (
    <div>
      <SectionHeader title="Terenski / Montažni izveštaji" subtitle={`${reports.length} izveštaj${reports.length === 1 ? "" : "a"}`} icon={FileText}
        actions={canAdd ? <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" />Novi izveštaj</Button> : undefined}
      />
      {reports.length === 0 ? (
        <EmptyState icon={FileText} title="Nema terenskih izveštaja" description="Još uvek nema izveštaja sa terena za ovaj posao ili filtere."
          actionLabel={canAdd ? "Dodaj izveštaj" : undefined} onAction={canAdd ? () => setCreateOpen(true) : undefined}
        />
      ) : (
        <div className="space-y-4">
          {reports.map((r) => {
            const relatedJob = r.job;
            return (
              <div key={r.id} className="bg-card rounded-xl border border-border p-4 sm:p-5 space-y-4 hover:shadow-sm transition-shadow cursor-pointer"
                onClick={() => { setSelectedReport(r); setDetailOpen(true); }}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <MapPin className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground text-sm">{r.address}</p>
                        {r.workOrderType && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                            {labelWorkOrderType(r.workOrderType)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {r.arrivalDate && <span>Dolazak: {new Date(r.arrivalDate).toLocaleString("sr-RS")}</span>}
                        {relatedJob && (
                          <button className="text-primary hover:underline font-medium" onClick={(e) => { e.stopPropagation(); navigate(`/jobs/${relatedJob.id}`); }}>
                            {relatedJob.jobNumber}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <GenericBadge label={r.arrived ? "Stigao" : "Nije stigao"} variant={r.arrived ? "success" : "muted"} />
                    <GenericBadge label={r.jobCompleted ? "Završeno" : "Nezavršeno"} variant={r.jobCompleted ? "success" : "warning"} />
                    <GenericBadge label={r.everythingOk ? "Sve OK" : "Problemi"} variant={r.everythingOk ? "success" : "danger"} />
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
                        <span key={i} className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">{item}</span>
                      ))}
                    </div>
                  </div>
                )}

                {r.images.length > 0 && (
                  <div onClick={(e) => e.stopPropagation()}>
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
      <NewFieldReportModal open={createOpen} onOpenChange={setCreateOpen} />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
