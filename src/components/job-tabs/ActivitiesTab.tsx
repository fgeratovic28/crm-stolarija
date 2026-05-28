import { useMemo, useState } from "react";
import { Phone, Mail, MessageSquare, Users, MoreHorizontal, Paperclip, Download } from "lucide-react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { publicUrlWithCacheBust } from "@/lib/r2-storage";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { AddActivityModal } from "@/components/modals/AddActivityModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Activity, CommunicationType } from "@/types";
import { isAutomatedActivityDescription } from "@/lib/activity-automation";
import { formatActivityDescriptionForDisplay } from "@/lib/activity-display-text";
import { JobCustomerLink } from "@/components/shared/JobCustomerLink";
import { toast } from "sonner";

type OriginFilter = "all" | "auto" | "manual";

const typeIcons: Record<CommunicationType, React.ElementType> = {
  email: Mail, phone: Phone, in_person: Users, viber: MessageSquare, other: MoreHorizontal,
};

const typeLabels: Record<CommunicationType, string> = {
  email: "Email", phone: "Telefon", in_person: "Lično", viber: "Viber", other: "Ostalo",
};

export type ActivityJobMeta = {
  jobNumber: string;
  customerName: string;
};

export function ActivitiesTab({
  activities,
  totalCount,
  showOriginFilter = false,
  jobMeta,
  onOpenJob,
}: {
  activities: Activity[];
  totalCount?: number;
  /** Jedan pregled liste + kontrola za automatsko vs ručno (npr. na strani posla). */
  showOriginFilter?: boolean;
  /** Broj posla i ime kupca po jobId (globalna lista aktivnosti). */
  jobMeta?: Map<string, ActivityJobMeta>;
  /** Sačuvaj listu i otvori posao (globalna strana aktivnosti). */
  onOpenJob?: (activityId: string, jobId: string) => void;
}) {
  const { id: currentJobId } = useParams();
  const [origin, setOrigin] = useState<OriginFilter>("all");

  const listForDisplay = useMemo(() => {
    if (!showOriginFilter || origin === "all") return activities;
    return activities.filter((a) => {
      const auto = isAutomatedActivityDescription(a.description);
      if (origin === "auto") return auto;
      return !auto;
    });
  }, [activities, origin, showOriginFilter]);

  const subtitleLine =
    showOriginFilter && origin !== "all" && activities.length > 0
      ? `${listForDisplay.length} od ${activities.length} zabeleženih aktivnosti`
      : `${typeof totalCount === "number" ? totalCount : listForDisplay.length} zabeleženih aktivnosti`;

  return (
    <div>
      <SectionHeader title="Istorija komunikacije" subtitle={subtitleLine} actions={<AddActivityModal />} />
      {showOriginFilter && activities.length > 0 && (
        <div className="mb-4">
          <Select value={origin} onValueChange={(v) => setOrigin(v as OriginFilter)}>
            <SelectTrigger className="h-8 max-w-[min(100%,260px)] text-xs">
              <SelectValue placeholder="Poreklo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Sve (automatske i ručne)</SelectItem>
              <SelectItem value="auto">Samo automatske</SelectItem>
              <SelectItem value="manual">Samo ručno unete</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {activities.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Nema aktivnosti" description="Još uvek nema zabeležene komunikacije za ovaj posao. Dodajte prvu aktivnost." actionLabel="Dodaj aktivnost" />
      ) : listForDisplay.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Ništa za ovaj filter"
          description="Nema aktivnosti koje odgovaraju izabranom filtru porekla."
          actionLabel="Prikaži sve"
          onAction={() => setOrigin("all")}
        />
      ) : (
        <div className="space-y-0 relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
          {listForDisplay.map((act) => {
            const Icon = typeIcons[act.type];
            const isAuto = isAutomatedActivityDescription(act.description);
            const displayDescription = isAuto ? act.description.replace("[AUTO] ", "") : act.description;
            // Only show job link if we're not already on a job details page
            const showJobLink = !currentJobId && act.jobId;
            const meta = act.jobId ? jobMeta?.get(act.jobId) : undefined;

            return (
              <div key={act.id} id={`activity-row-${act.id}`} className="relative pl-12 pb-5 scroll-mt-4">
                <div className="absolute left-3 top-1 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-card z-10">
                  <Icon className="w-3 h-3 text-primary" />
                </div>
                <div className="bg-card rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">{typeLabels[act.type]}</span>
                      {isAuto && (
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          Autom.
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{act.createdBy}</span>
                      {showJobLink && (
                        meta ? (
                          <JobCustomerLink
                            jobId={act.jobId}
                            jobNumber={meta.jobNumber}
                            customerName={meta.customerName}
                            onClick={
                              onOpenJob ? () => onOpenJob(act.id, act.jobId) : undefined
                            }
                          />
                        ) : (
                          <JobCustomerLink
                            jobId={act.jobId}
                            jobNumber="Posao"
                            onClick={
                              onOpenJob ? () => onOpenJob(act.id, act.jobId) : undefined
                            }
                          />
                        )
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleString("sr-RS")}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{displayDescription}</p>
                  {act.attachmentFileId && (
                    <button
                      onClick={async () => {
                        try {
                          const fileRow = await supabase
                            .from("files")
                            .select("storage_key, storage_url")
                            .eq("id", act.attachmentFileId)
                            .single();

                          if (fileRow.error || !fileRow.data) {
                            toast.error("Greška pri preuzimanju", {
                              description: "Informacije o fajlu nisu pronađene",
                            });
                            return;
                          }

                          const { storage_key, storage_url } = fileRow.data as {
                            storage_key?: string | null;
                            storage_url?: string | null;
                          };

                          // Pokušaj R2 prvo (storage_url), zatim Supabase storage (storage_key)
                          let downloadUrl: string | null = null;

                          if (storage_url) {
                            // R2 — dodaj cache-bust i direktno preuzmite
                            downloadUrl = publicUrlWithCacheBust(storage_url);
                          } else if (storage_key) {
                            // Stariji Supabase storage (ako postoji)
                            const { data, error: dlErr } = await supabase.storage
                              .from("files")
                              .download(storage_key);

                            if (dlErr || !data) {
                              toast.error("Greška pri preuzimanju", { description: dlErr?.message });
                              return;
                            }

                            downloadUrl = URL.createObjectURL(data);
                          }

                          if (!downloadUrl) {
                            toast.error("Greška", { description: "Nema dostupnog URL-a za fajl" });
                            return;
                          }

                          // Preuzmi kroz link
                          const a = document.createElement("a");
                          a.href = downloadUrl;
                          a.download = act.attachmentName || "prilog";
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);

                          // Ako je objekat URL (Supabase), revoke ga
                          if (downloadUrl.startsWith("blob:")) {
                            URL.revokeObjectURL(downloadUrl);
                          }
                        } catch (err) {
                          toast.error("Greška", {
                            description: err instanceof Error ? err.message : "Nije moguće preuzeti prilog",
                          });
                        }
                      }}
                      className="flex items-center gap-1.5 mt-2 text-xs text-primary hover:text-primary/80 hover:underline transition-colors"
                    >
                      <Paperclip className="w-3 h-3" />
                      <Download className="w-3 h-3" />
                      {act.attachmentName}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
