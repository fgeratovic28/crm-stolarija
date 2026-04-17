import { Phone, Mail, MessageSquare, Users, MoreHorizontal, Paperclip } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { EmptyState } from "@/components/shared/EmptyState";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { AddActivityModal } from "@/components/modals/AddActivityModal";
import type { Activity, CommunicationType } from "@/types";

const typeIcons: Record<CommunicationType, React.ElementType> = {
  email: Mail, phone: Phone, in_person: Users, viber: MessageSquare, other: MoreHorizontal,
};

const typeLabels: Record<CommunicationType, string> = {
  email: "Email", phone: "Telefon", in_person: "Lično", viber: "Viber", other: "Ostalo",
};

export function ActivitiesTab({ activities }: { activities: Activity[] }) {
  const navigate = useNavigate();
  const { id: currentJobId } = useParams();

  return (
    <div>
      <SectionHeader title="Istorija komunikacije" subtitle={`${activities.length} zabeleženih aktivnosti`} actions={<AddActivityModal />} />
      {activities.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Nema aktivnosti" description="Još uvek nema zabeležene komunikacije za ovaj posao. Dodajte prvu aktivnost." actionLabel="Dodaj aktivnost" />
      ) : (
        <div className="space-y-0 relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
          {activities.map((act) => {
            const Icon = typeIcons[act.type];
            const isAuto = act.description.startsWith("[AUTO] ");
            const displayDescription = isAuto ? act.description.replace("[AUTO] ", "") : act.description;
            // Only show job link if we're not already on a job details page
            const showJobLink = !currentJobId && act.jobId;
            
            return (
              <div key={act.id} className="relative pl-12 pb-5">
                <div className="absolute left-3 top-1 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center ring-4 ring-card z-10">
                  <Icon className="w-3 h-3 text-primary" />
                </div>
                <div className="bg-card rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">{typeLabels[act.type]}</span>
                      {isAuto && (
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          AUTO
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{act.createdBy}</span>
                      {showJobLink && (
                        <button 
                          className="text-[10px] text-primary hover:underline font-medium" 
                          onClick={() => navigate(`/jobs/${act.jobId}`)}
                        >
                          Pregledaj posao
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(act.createdAt).toLocaleString("sr-RS")}</span>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{displayDescription}</p>
                  {act.attachmentName && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-primary">
                      <Paperclip className="w-3 h-3" /> {act.attachmentName}
                    </div>
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
