import { useNavigate, useParams } from "react-router-dom";
import { FileText, Image as ImageIcon, Download, Upload, Trash2, FolderOpen, Loader2 } from "lucide-react";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { UploadFileModal } from "@/components/modals/UploadFileModal";
import { useRole } from "@/contexts/RoleContext";
import { useFiles } from "@/hooks/use-files";
import { formatDateByAppLanguage } from "@/lib/app-settings";
import { publicUrlForStorageKey } from "@/lib/r2-storage";
import { JobCustomerLink } from "@/components/shared/JobCustomerLink";
import type { JobDetailsReturnState } from "@/lib/job-details-return";
import { toast } from "sonner";
import type { AppFile } from "@/types";

type FilesJobMeta = { jobNumber: string; customerName: string };

const categoryLabels: Record<string, string> = {
  offers: "Ponude", communication: "Komunikacija", finance: "Finansije",
  supplier: "Dobavljač", work_order: "Radni nalozi", field_photos: "Terenske foto.", reports: "Izveštaji",
};

export function FilesTab({
  files,
  totalCount,
  jobMeta,
  jobListReturn,
  emptyDescription,
}: {
  files: AppFile[];
  /** Ukupan broj posle filtera (globalna strana); podrazumevano `files.length`. */
  totalCount?: number;
  jobMeta?: Map<string, FilesJobMeta>;
  /** Sa globalne strane fajlova — dugme Nazad na kartici posla. */
  jobListReturn?: JobDetailsReturnState;
  emptyDescription?: string;
}) {
  const navigate = useNavigate();
  const { id: currentJobId } = useParams();
  const { canPerformAction } = useRole();
  const { deleteFile } = useFiles();
  const displayCount = totalCount ?? files.length;

  const handleDelete = (file: AppFile) => {
    deleteFile.mutate(file.id);
  };

  const handleDownload = async (file: AppFile) => {
    try {
      if (file.storageUrl) {
        window.open(file.storageUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (file.storageKey) {
        const url = publicUrlForStorageKey(file.storageKey);
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      toast.info("Preuzimanje nije dostupno", {
        description: "Ovaj zapis nema URL ni ključ skladišta (stariji upload).",
      });
    } catch (err) {
      toast.error("Greška pri preuzimanju");
    }
  };

  return (
    <div>
      <SectionHeader
        title="Fajlovi i dokumenta"
        subtitle={`${displayCount} fajl${displayCount === 1 ? "" : "ova"}`}
        icon={FolderOpen}
        actions={canPerformAction("upload_file") ? <UploadFileModal /> : undefined}
      />

      {canPerformAction("upload_file") && (
        <UploadFileModal 
          trigger={
            <div className="border-2 border-dashed border-border rounded-xl p-6 sm:p-8 text-center mb-4 hover:border-primary/50 transition-colors cursor-pointer group">
              <Upload className="w-7 h-7 text-muted-foreground mx-auto mb-2 group-hover:text-primary transition-colors" />
              <p className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Prevucite fajlove ovde ili kliknite za pretragu</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, slike, dokumenta do 20MB</p>
            </div>
          }
        />
      )}

      {files.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nema otpremljenih fajlova"
          description={
            emptyDescription ??
            "Nema fajlova za trenutne filtere ili posao. Otpremite prvi dokument."
          }
          actionLabel={canPerformAction("upload_file") ? "Otpremi fajl" : undefined}
        />
      ) : (
        <div className="grid gap-2">
          {files.map((f) => {
            const showJobLink = !currentJobId && f.jobId;
            const meta = f.jobId ? jobMeta?.get(f.jobId) : undefined;
            return (
              <div key={f.id} className="bg-card rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 sm:gap-4 hover:shadow-sm transition-shadow">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  {f.type === "image" ? <ImageIcon className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                    <span>{f.size}</span>
                    <span>·</span>
                    <span>{f.uploadedBy}</span>
                    <span>·</span>
                    <span>{formatDateByAppLanguage(f.uploadedAt)}</span>
                    {showJobLink && f.jobId && (
                      <>
                        <span>·</span>
                        {meta ? (
                          <JobCustomerLink
                            jobId={f.jobId}
                            jobNumber={meta.jobNumber}
                            customerName={meta.customerName}
                            returnState={jobListReturn}
                            className="text-[11px]"
                          />
                        ) : (
                          <button
                            type="button"
                            className="font-medium text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(
                                `/jobs/${f.jobId}`,
                                jobListReturn ? { state: jobListReturn } : undefined,
                              );
                            }}
                          >
                            Pregledaj posao
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <GenericBadge label={categoryLabels[f.category] || f.category} variant="muted" className="hidden sm:inline-flex" />
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => handleDownload(f)}>
                  <Download className="w-4 h-4" />
                </Button>
                {canPerformAction("delete_file") && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deleteFile.isPending}>
                        {deleteFile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    }
                    title="Obrisati ovaj fajl?"
                    description={`„${f.name}” će biti uklonjen sa skladišta. Ova radnja se ne može poništiti.`}
                    confirmLabel="Obriši fajl"
                    cancelLabel="Otkaži"
                    onConfirm={() => handleDelete(f)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
