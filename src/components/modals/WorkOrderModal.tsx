import { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { WorkOrder, WorkOrderType, Team, Job } from "@/types";
import { useTeams } from "@/hooks/use-teams";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { MapPin, ExternalLink, ClipboardList, Calendar, Users, Info, Check, ChevronsUpDown } from "lucide-react";

interface WorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (order: Omit<WorkOrder, "id"> | WorkOrder) => void;
  jobId?: string;
  order?: WorkOrder;
  readOnly?: boolean;
}

const workOrderTypes: { value: WorkOrderType; label: string }[] = [
  { value: "measurement", label: "Merenje" },
  { value: "measurement_verification", label: "Provera mera" },
  { value: "installation", label: "Ugradnja" },
  { value: "complaint", label: "Reklamacija" },
  { value: "service", label: "Servis" },
  { value: "production", label: "Proizvodnja" },
  { value: "site_visit", label: "Terenska poseta" },
  { value: "control_visit", label: "Kontrolna poseta" },
];

const nonCompletedJobStatuses = [
  "new",
  "active",
  "in_progress",
  "waiting_materials",
  "scheduled",
  "complaint",
  "service",
] as const;

export function WorkOrderModal({ isOpen, onClose, onSave, jobId, order, readOnly = false }: WorkOrderModalProps) {
  const { teams } = useTeams();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [jobSelectOpen, setJobSelectOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const orderWithJob = order as (WorkOrder & { job?: { id: string, jobNumber: string, installationAddress?: string, customer?: { fullName: string } } }) | undefined;
  
  const { data: jobDetails } = useQuery({
    queryKey: ["job-details-for-modal", orderWithJob?.jobId || jobId],
    queryFn: async () => {
      const id = orderWithJob?.jobId || jobId;
      if (!id) return null;
      const preferred = await supabase
        .from("jobs")
        .select("id, job_number, installation_address, customers (*)")
        .eq("id", id)
        .single();
      if (!preferred.error) return preferred.data;
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, installation_address")
        .eq("id", id)
        .single();
      if (fallback.error) throw fallback.error;
      return fallback.data;
    },
    enabled: isOpen && !!(orderWithJob?.jobId || jobId),
  });

  const displayJob = jobDetails ? {
    id: jobDetails.id,
    jobNumber: jobDetails.job_number,
    installationAddress: jobDetails.installation_address,
    customerName: Array.isArray(jobDetails.customers)
      ? ((jobDetails.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
        (jobDetails.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name)
      : ((jobDetails.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
        (jobDetails.customers as { name?: string; full_name?: string } | null | undefined)?.full_name)
  } : (orderWithJob?.job ? {
    id: orderWithJob.job.id,
    jobNumber: orderWithJob.job.jobNumber,
    installationAddress: orderWithJob.job.installationAddress,
    customerName: orderWithJob.job.customer?.fullName
  } : null);

  const { data: jobs } = useQuery({
    queryKey: ["jobs-list-minimal"],
    queryFn: async () => {
      const preferred = await supabase
        .from("jobs")
        .select("id, job_number, status, customers (*)")
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (!preferred.error) return preferred.data ?? [];
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, status")
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      return fallback.data ?? [];
    },
    enabled: isOpen && !jobId && !readOnly,
  });

  const [formData, setFormData] = useState<Omit<WorkOrder, "id"> | WorkOrder>({
    jobId: jobId || "",
    type: "measurement",
    description: "",
    assignedTeamId: "",
    date: new Date().toISOString().split("T")[0],
    status: "pending",
    attachmentName: "",
    installationRef: "",
    productionRef: ""
  });

  useEffect(() => {
    if (order) {
      setFormData(order);
    } else {
      const defaultTeamId =
        user?.teamId && teams?.some((t) => t.id === user.teamId && t.active)
          ? user.teamId
          : "";
      setFormData({
        jobId: jobId || "",
        type: "measurement",
        description: "",
        assignedTeamId: defaultTeamId,
        date: new Date().toISOString().split("T")[0],
        status: "pending",
        attachmentName: "",
        installationRef: "",
        productionRef: ""
      });
    }
  }, [order, isOpen, jobId, user?.teamId, teams]);

  useEffect(() => {
    if (!isOpen) {
      setJobSearch("");
      setJobSelectOpen(false);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!formData.jobId) {
      toast({
        title: "Nedostaje posao",
        description: "Izaberite posao za koji kreirate radni nalog.",
        variant: "destructive",
      });
      return;
    }
    if (!formData.assignedTeamId) {
      toast({
        title: "Nedostaje tim",
        description: "Dodelite radni nalog timu pre čuvanja.",
        variant: "destructive",
      });
      return;
    }
    onSave(formData);
    onClose();
  };

  const openInGoogleMaps = (address: string) => {
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
  };

  const statusLabels: Record<string, string> = {
    completed: "Završen", in_progress: "U toku", pending: "Na čekanju", canceled: "Otkazan",
  };

  const selectedTeam = teams?.find(t => t.id === formData.assignedTeamId);
  const selectableJobs = jobs ?? [];
  const filteredJobs = selectableJobs.filter((j) => {
    const customerName = Array.isArray(j.customers)
      ? ((j.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
        (j.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
        "")
      : ((j.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
        (j.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
        "");
    const q = jobSearch.trim().toLowerCase();
    if (!q) return true;
    return j.job_number.toLowerCase().includes(q) || customerName.toLowerCase().includes(q);
  });
  const selectedJob = selectableJobs.find((j) => j.id === formData.jobId);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "Detalji radnog naloga" : (order ? "Izmeni radni nalog" : "Dodaj novi radni nalog")}
          </DialogTitle>
          <DialogDescription>
            {readOnly ? "Informacije o zadatku i lokaciji rada." : "Unesite detalje o radnom nalogu. Sva polja sa zvezdicom su obavezna."}
          </DialogDescription>
        </DialogHeader>

        {readOnly ? (
          <div className="space-y-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><ClipboardList className="w-3 h-3" /> Tip naloga</p>
                <p className="text-sm font-semibold">{workOrderTypes.find(t => t.value === formData.type)?.label}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end"><Calendar className="w-3 h-3" /> Datum</p>
                <p className="text-sm font-semibold">{formData.date}</p>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Info className="w-3 h-3" /> Opis posla</p>
              <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed border border-border">
                {formData.description}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Tim</p>
                <p className="text-sm font-medium">{selectedTeam?.name || "Nedodeljen"}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-medium">{statusLabels[formData.status] || formData.status}</p>
              </div>
            </div>

            {displayJob && (
              <div className="pt-4 border-t border-border space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Posao</p>
                  <p className="text-sm font-semibold">
                    {displayJob.jobNumber} — {displayJob.customerName || "Kupac"}
                  </p>
                </div>
                
                {displayJob.installationAddress && (
                  <div className="p-3 bg-primary/5 rounded-lg border border-primary/20 space-y-2">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wider">Lokacija rada</p>
                        <p className="text-sm font-medium text-foreground">{displayJob.installationAddress}</p>
                      </div>
                    </div>
                    <Button 
                      variant="link" 
                      size="sm" 
                      className="h-auto p-0 text-xs font-bold flex items-center gap-1 text-primary hover:text-primary/80"
                      onClick={() => openInGoogleMaps(displayJob.installationAddress!)}
                    >
                      <ExternalLink className="w-3 h-3" /> Otvori u Google Mapama
                    </Button>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button onClick={onClose} className="w-full sm:w-auto">Zatvori</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            {!jobId && !order && (
              <div className="grid gap-2">
                <Label htmlFor="jobId">Posao *</Label>
                <Popover open={jobSelectOpen} onOpenChange={setJobSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={jobSelectOpen} className="justify-between">
                      {selectedJob
                        ? `${selectedJob.job_number} — ${
                            Array.isArray(selectedJob.customers)
                              ? ((selectedJob.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
                                (selectedJob.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
                                "Kupac")
                              : ((selectedJob.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
                                (selectedJob.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
                                "Kupac")
                          }`
                        : "Izaberite posao"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width]">
                    <Command>
                      <CommandInput placeholder="Pretraži posao ili kupca..." value={jobSearch} onValueChange={setJobSearch} />
                      <CommandList>
                        <CommandEmpty>Nema rezultata.</CommandEmpty>
                        <CommandGroup>
                          {filteredJobs.map((j) => {
                            const customerName = Array.isArray(j.customers)
                              ? ((j.customers[0] as { name?: string; full_name?: string } | undefined)?.name ??
                                (j.customers[0] as { name?: string; full_name?: string } | undefined)?.full_name ??
                                "Kupac")
                              : ((j.customers as { name?: string; full_name?: string } | null | undefined)?.name ??
                                (j.customers as { name?: string; full_name?: string } | null | undefined)?.full_name ??
                                "Kupac");
                            return (
                              <CommandItem
                                key={j.id}
                                value={`${j.job_number} ${customerName}`}
                                onSelect={() => {
                                  setFormData({ ...formData, jobId: j.id });
                                  setJobSelectOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.jobId === j.id ? "opacity-100" : "opacity-0"}`} />
                                {j.job_number} — {customerName}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="type">Tip naloga *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: WorkOrderType) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tip" />
                </SelectTrigger>
                <SelectContent>
                  {workOrderTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Opis posla *</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="npr. Merenje 5 prozora na drugom spratu..."
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="team">Dodeljen tim *</Label>
              <Select
                value={formData.assignedTeamId}
                onValueChange={(value) => setFormData({ ...formData, assignedTeamId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tim" />
                </SelectTrigger>
                <SelectContent>
                  {teams?.filter(t => t.active).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="date">Datum *</Label>
              <Input
                id="date"
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: WorkOrder["status"]) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Na čekanju</SelectItem>
                  <SelectItem value="in_progress">U toku</SelectItem>
                  <SelectItem value="completed">Završeno</SelectItem>
                  <SelectItem value="canceled">Otkazano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Otkaži
              </Button>
              <Button type="submit">Sačuvaj</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
