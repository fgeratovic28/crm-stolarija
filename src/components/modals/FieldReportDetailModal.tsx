import { MapPin, CheckCircle, XCircle, Camera, AlertTriangle, Calendar, Ruler, StickyNote, Package, FileDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { Separator } from "@/components/ui/separator";
import { formatDateByAppLanguage, formatDateTimeBySettings } from "@/lib/app-settings";
import { exportFieldReportPDF } from "@/lib/export-documents";
import type { FieldReport } from "@/types";

interface FieldReportDetailModalProps {
  report: FieldReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FieldReportDetailModal({ report, open, onOpenChange }: FieldReportDetailModalProps) {
  if (!report) return null;

  const relatedJob = report.job;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Detalji terenskog izveštaja
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Location & Job */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{report.address}</p>
            {relatedJob && (
              <p className="text-xs text-muted-foreground">Posao: <span className="text-primary font-medium">{relatedJob.jobNumber}</span> — {relatedJob.customer.fullName}</p>
            )}
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-2">
            <GenericBadge label={report.arrived ? "Stigao na teren" : "Nije stigao"} variant={report.arrived ? "success" : "muted"} />
            <GenericBadge label={report.jobCompleted ? "Posao završen" : "Posao nezavršen"} variant={report.jobCompleted ? "success" : "warning"} />
            <GenericBadge label={report.everythingOk ? "Sve u redu" : "Ima problema"} variant={report.everythingOk ? "success" : "danger"} />
            {report.siteCanceled && <GenericBadge label="Teren otkazan" variant="danger" />}
          </div>

          <Separator />

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            {report.arrivalDate && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Datum dolaska</p>
                <p className="text-sm text-foreground">{formatDateTimeBySettings(report.arrivalDate)}</p>
              </div>
            )}
            {report.handoverDate && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" />Datum primopredaje</p>
                <p className="text-sm text-foreground">{formatDateByAppLanguage(report.handoverDate)}</p>
              </div>
            )}
          </div>

          {/* Cancel reason */}
          {report.siteCanceled && report.cancelReason && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                <XCircle className="w-4 h-4" /> Razlog otkazivanja
              </div>
              <p className="text-sm text-foreground">{report.cancelReason}</p>
            </div>
          )}

          {/* Issues */}
          {report.issueDescription && (
            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                <AlertTriangle className="w-4 h-4" /> Pronađeni problemi
              </div>
              <p className="text-sm text-foreground leading-relaxed">{report.issueDescription}</p>
            </div>
          )}

          {/* Measurements */}
          {report.measurements && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Ruler className="w-3.5 h-3.5" />Mere</p>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3">{report.measurements}</p>
            </div>
          )}

          {/* General notes */}
          {report.generalNotes && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" />Napomene</p>
              <p className="text-sm text-foreground bg-muted/50 rounded-lg p-3 leading-relaxed">{report.generalNotes}</p>
            </div>
          )}

          {/* Missing items */}
          {report.missingItems.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Package className="w-3.5 h-3.5" />Nedostajući delovi</p>
              <div className="flex flex-wrap gap-1.5">
                {report.missingItems.map((item, i) => (
                  <span key={i} className="text-xs bg-destructive/10 text-destructive px-2.5 py-1 rounded-full font-medium">{item}</span>
                ))}
              </div>
            </div>
          )}

          {/* Additional needs */}
          {report.additionalNeeds.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Dodatne potrebe</p>
              <ul className="space-y-1">
                {report.additionalNeeds.map((need, i) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    {need}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Images */}
          {report.images.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Camera className="w-3.5 h-3.5" />Fotografije ({report.images.length})</p>
              <div className="grid grid-cols-4 gap-2">
                {report.images.map((img, i) => (
                  <div key={i} className="aspect-square bg-muted rounded-lg flex flex-col items-center justify-center gap-1">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground truncate max-w-full px-1">{img}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-border">
          <Button variant="outline" className="w-full" onClick={() => void exportFieldReportPDF(report)}>
            <FileDown className="w-4 h-4 mr-1.5" />Preuzmi PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
