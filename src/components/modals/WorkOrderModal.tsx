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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { WorkOrder, WorkOrderType } from "@/types";
import { useTeams } from "@/hooks/use-teams";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/stores/auth-store";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  MapPin,
  ExternalLink,
  ClipboardList,
  Calendar,
  Users,
  Info,
  Check,
  ChevronsUpDown,
  Phone,
  Mail,
  Clock,
  Hash,
  Package,
  Link as LinkIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { sr } from "date-fns/locale";
import { jobPrimaryPhone } from "@/lib/job-contact-phone";
import { labelJobStatus, labelWorkOrderStatus, labelWorkOrderType } from "@/lib/activity-labels";
import { WORK_ORDER_TYPE_SELECT_GROUPS } from "@/lib/work-order-types-ui";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { Separator } from "@/components/ui/separator";
import { workOrderTypeDetailHint } from "@/lib/work-order-detail-hints";
import { cn } from "@/lib/utils";
import { AddressMiniMap } from "@/components/shared/AddressMiniMap";
import { ProductionMaterialTab } from "@/components/job-tabs/ProductionMaterialTab";

/** Vrednost u Select-u za RN bez tima (mapira se na null u bazi). */
const WORK_ORDER_UNASSIGNED_TEAM = "__work_order_unassigned__";

interface WorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (order: Omit<WorkOrder, "id"> | WorkOrder) => void;
  jobId?: string;
  order?: WorkOrder;
  readOnly?: boolean;
}

const nonCompletedJobStatuses = [
  "new",
  "quote_sent",
  "accepted",
  "measuring",
  "measurement_processing",
  "ready_for_work",
  "waiting_material",
  "in_production",
  "scheduled",
  "installation_in_progress",
  "complaint",
  "service",
  "canceled",
] as const;

export function WorkOrderModal({ isOpen, onClose, onSave, jobId, order, readOnly = false }: WorkOrderModalProps) {
  const { teams } = useTeams();
  const { toast } = useToast();
  const { user } = useAuthStore();
  const [jobSelectOpen, setJobSelectOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const orderWithJob = order as
    | (WorkOrder & {
        job?: { id: string; jobNumber: string; installationAddress?: string; customer?: { fullName: string } };
        assignedTeamName?: string;
      })
    | undefined;

  const [formData, setFormData] = useState<Omit<WorkOrder, "id"> | WorkOrder>({
    jobId: jobId || "",
    type: "measurement",
    description: "",
    assignedTeamId: "",
    date: new Date().toISOString().split("T")[0],
    status: "pending",
    attachmentName: "",
    installationRef: "",
    productionRef: "",
  });

  const effectiveJobId = (orderWithJob?.jobId || jobId || formData.jobId || "").trim();

  const { data: jobDetails, isLoading: jobDetailsLoading, isError: jobDetailsError } = useQuery({
    queryKey: ["job-details-for-modal", effectiveJobId],
    queryFn: async () => {
      if (!effectiveJobId) return null;
      const preferred = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, summary, installation_address, billing_address, customer_phone, estimated_installation_hours, customers (name, phones, emails, contact_person, installation_address, billing_address)",
        )
        .eq("id", effectiveJobId)
        .single();
      if (!preferred.error) return preferred.data;
      const mid = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, summary, installation_address, customer_phone, estimated_installation_hours, customers (name, phones, emails, contact_person)",
        )
        .eq("id", effectiveJobId)
        .single();
      if (!mid.error) return mid.data;
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, installation_address, estimated_installation_hours")
        .eq("id", effectiveJobId)
        .single();
      if (fallback.error) throw fallback.error;
      return fallback.data;
    },
    enabled: isOpen && effectiveJobId.length > 0,
  });

  const { data: quoteLines, isLoading: quoteLinesLoading } = useQuery({
    queryKey: ["job-quote-lines-modal", effectiveJobId],
    queryFn: async () => {
      const preferredQuotes = await supabase
        .from("quotes")
        .select("id, status, is_final, note, version_number, updated_at, created_at")
        .eq("job_id", effectiveJobId)
        .eq("status", "accepted")
        .order("version_number", { ascending: false });
      const fallbackQuotes = preferredQuotes.error
        ? await supabase
            .from("quotes")
            .select("id, status, note, version_number, updated_at, created_at")
            .eq("job_id", effectiveJobId)
            .eq("status", "accepted")
            .order("version_number", { ascending: false })
        : null;
      const quotesError = preferredQuotes.error && fallbackQuotes?.error ? fallbackQuotes.error : null;
      if (quotesError) throw quotesError;
      const acceptedQuotes = (preferredQuotes.error ? fallbackQuotes?.data : preferredQuotes.data) ?? [];

      const finalAccepted = acceptedQuotes.find((q) => {
        const isFinal = (q as { is_final?: boolean | null }).is_final === true;
        const note = typeof q.note === "string" ? q.note.trim().toLowerCase() : "";
        return isFinal || note.startsWith("[final]");
      });
      const targetQuoteId = finalAccepted?.id ?? acceptedQuotes[0]?.id;
      if (targetQuoteId) {
        const fromQuoteLines = await supabase
          .from("quote_lines")
          .select("id, description, quantity, sort_order")
          .eq("quote_id", targetQuoteId)
          .order("sort_order", { ascending: true });
        if (!fromQuoteLines.error) {
          return (fromQuoteLines.data ?? []) as { id: string; description: string; quantity: number; sort_order: number }[];
        }
      }

      const fromJobLines = await supabase
        .from("job_quote_lines")
        .select("id, description, quantity, sort_order")
        .eq("job_id", effectiveJobId)
        .order("sort_order", { ascending: true });
      if (fromJobLines.error) throw fromJobLines.error;
      return (fromJobLines.data ?? []) as { id: string; description: string; quantity: number; sort_order: number }[];
    },
    enabled: isOpen && readOnly && effectiveJobId.length > 0,
  });

  const displayJob = jobDetails
    ? {
        id: jobDetails.id as string,
        jobNumber: jobDetails.job_number as string,
        installationAddress: jobDetails.installation_address as string | undefined,
        billingAddress: (jobDetails as { billing_address?: string }).billing_address,
        customerPhone: (jobDetails as { customer_phone?: string | null }).customer_phone,
        estimatedInstallationHours: (() => {
          const raw = (jobDetails as { estimated_installation_hours?: unknown }).estimated_installation_hours;
          if (raw === null || raw === undefined) return undefined;
          const n = typeof raw === "number" ? raw : Number(raw);
          return Number.isFinite(n) ? n : undefined;
        })(),
        jobStatus: (jobDetails as { status?: string }).status,
        summary: (jobDetails as { summary?: string }).summary,
        customerName: Array.isArray(jobDetails.customers)
          ? String(
              (jobDetails.customers[0] as { name?: string } | undefined)?.name ??
                (jobDetails.customers[0] as { full_name?: string } | undefined)?.full_name ??
                "",
            )
          : String(
              (jobDetails.customers as { name?: string } | null | undefined)?.name ??
                (jobDetails.customers as { full_name?: string } | null | undefined)?.full_name ??
                "",
            ),
        contactPerson: Array.isArray(jobDetails.customers)
          ? String((jobDetails.customers[0] as { contact_person?: string } | undefined)?.contact_person ?? "")
          : String((jobDetails.customers as { contact_person?: string } | null | undefined)?.contact_person ?? ""),
        customerInstallation: Array.isArray(jobDetails.customers)
          ? String((jobDetails.customers[0] as { installation_address?: string } | undefined)?.installation_address ?? "")
          : String(
              (jobDetails.customers as { installation_address?: string } | null | undefined)?.installation_address ?? "",
            ),
        customerPhones: (Array.isArray(jobDetails.customers)
          ? (jobDetails.customers[0] as { phones?: string[] } | undefined)?.phones
          : (jobDetails.customers as { phones?: string[] } | null | undefined)?.phones) as string[] | undefined,
        customerEmails: (Array.isArray(jobDetails.customers)
          ? (jobDetails.customers[0] as { emails?: string[] } | undefined)?.emails
          : (jobDetails.customers as { emails?: string[] } | null | undefined)?.emails) as string[] | undefined,
      }
    : orderWithJob?.job
      ? {
          id: orderWithJob.job.id,
          jobNumber: orderWithJob.job.jobNumber,
          installationAddress: orderWithJob.job.installationAddress,
          customerName: orderWithJob.job.customer?.fullName,
        }
      : null;

  const { data: jobs } = useQuery({
    queryKey: ["jobs-list-minimal"],
    queryFn: async () => {
      const preferred = await supabase
        .from("jobs")
        .select(
          "id, job_number, status, installation_address, customer_phone, summary, customers (name, phones, emails, contact_person, installation_address)",
        )
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (!preferred.error) return preferred.data ?? [];
      const fallback = await supabase
        .from("jobs")
        .select("id, job_number, status, installation_address, customer_phone")
        .in("status", nonCompletedJobStatuses)
        .order("created_at", { ascending: false });
      if (fallback.error) throw fallback.error;
      return fallback.data ?? [];
    },
    enabled: isOpen && !jobId && !readOnly,
  });

  useEffect(() => {
    if (order) {
      setFormData({
        ...order,
        assignedTeamId: order.assignedTeamId ?? WORK_ORDER_UNASSIGNED_TEAM,
      });
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
    const resolvedTeamId =
      !formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM
        ? undefined
        : formData.assignedTeamId;
    if (!resolvedTeamId && !order) {
      toast({
        title: "Nedostaje tim",
        description: "Dodelite radni nalog timu pre čuvanja.",
        variant: "destructive",
      });
      return;
    }
    onSave({ ...formData, assignedTeamId: resolvedTeamId });
    onClose();
  };

  const openInGoogleMaps = (address: string) => {
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank');
  };

  const selectedTeam = teams?.find(
    (t) =>
      t.id === formData.assignedTeamId &&
      formData.assignedTeamId !== WORK_ORDER_UNASSIGNED_TEAM,
  );
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

  const jobSummaryPhone = displayJob
    ? jobPrimaryPhone({
        customerPhone:
          "customerPhone" in displayJob && displayJob.customerPhone != null
            ? String(displayJob.customerPhone)
            : null,
        customer: {
          phones:
            "customerPhones" in displayJob && Array.isArray(displayJob.customerPhones)
              ? displayJob.customerPhones
              : [],
        },
      })
    : "";

  const jobSummaryEmail =
    displayJob &&
    "customerEmails" in displayJob &&
    Array.isArray((displayJob as { customerEmails?: string[] }).customerEmails)
      ? (displayJob as { customerEmails: string[] }).customerEmails.find((e) => typeof e === "string" && e.trim()) ?? ""
      : "";

  const workInstallationAddress =
    displayJob?.installationAddress ||
    (displayJob && "customerInstallation" in displayJob
      ? (displayJob as { customerInstallation?: string }).customerInstallation
      : "") ||
    "";

  const woStatusVariant: Record<WorkOrder["status"], "success" | "warning" | "info" | "muted"> = {
    completed: "success",
    in_progress: "info",
    pending: "warning",
    canceled: "muted",
  };

  const formatWoDate = (d: string) => {
    try {
      return format(parseISO(d), "d. MMMM yyyy.", { locale: sr });
    } catch {
      return d;
    }
  };
  const formatWoDateTime = (d: string) => {
    try {
      return format(parseISO(d), "d. MMMM yyyy. HH:mm", { locale: sr });
    } catch {
      return d;
    }
  };

  const readOnlyTeamLabel =
    orderWithJob?.assignedTeamName ||
    selectedTeam?.name ||
    (!formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM
      ? "Neraspoređeno (čeka dodelu tima)"
      : "—");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          "w-full max-h-[90vh] overflow-y-auto",
          readOnly ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {readOnly ? "Detalji radnog naloga" : (order ? "Izmeni radni nalog" : "Dodaj novi radni nalog")}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Tip, tim, datum, opis zadatka, posao, ponuda i lokacija — sve na jednom mestu."
              : "Unesite detalje o radnom nalogu. Sva polja sa zvezdicom su obavezna."}
          </DialogDescription>
        </DialogHeader>

        {readOnly ? (
          <div className="space-y-5 py-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1 min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Radni nalog</p>
                <p className="text-xl font-semibold text-foreground leading-tight">{labelWorkOrderType(formData.type)}</p>
                {displayJob?.id ? (
                  <Link
                    to={`/jobs/${displayJob.id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    <LinkIcon className="w-3.5 h-3.5 shrink-0" />
                    Posao {displayJob.jobNumber}
                  </Link>
                ) : displayJob?.jobNumber ? (
                  <p className="text-sm text-muted-foreground">Posao {displayJob.jobNumber}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <GenericBadge label={labelWorkOrderStatus(formData.status)} variant={woStatusVariant[formData.status]} />
                {(!formData.assignedTeamId || formData.assignedTeamId === WORK_ORDER_UNASSIGNED_TEAM) && (
                  <GenericBadge label="Neraspoređeno" variant="warning" />
                )}
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed border-l-[3px] border-primary/35 pl-3 py-2 rounded-r-md bg-muted/50">
              {workOrderTypeDetailHint(formData.type)}
            </p>

            {formData.type === "installation" &&
            displayJob &&
            "estimatedInstallationHours" in displayJob &&
            typeof (displayJob as { estimatedInstallationHours?: number }).estimatedInstallationHours === "number" ? (
              <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <Clock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wide">Procena trajanja ugradnje</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {(displayJob as { estimatedInstallationHours: number }).estimatedInstallationHours} h
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Uneta pri merenju i vezana za posao; koristi montaža pri pripremi ugradnje.
                  </p>
                </div>
              </div>
            ) : null}

            {formData.type !== "installation" &&
            displayJob &&
            "estimatedInstallationHours" in displayJob &&
            typeof (displayJob as { estimatedInstallationHours?: number }).estimatedInstallationHours === "number" ? (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
                <Clock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Planirana procena ugradnje (posao)</p>
                  <p className="text-base font-semibold tabular-nums">
                    {(displayJob as { estimatedInstallationHours: number }).estimatedInstallationHours} h
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Pomaže planiranju; ugradnja ima poseban radni nalog kada dođe na red.
                  </p>
                </div>
              </div>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" /> Opis zadatka
              </h3>
              <div className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {formData.description?.trim() ? formData.description : "—"}
              </div>
            </section>

            {(formData.productionRef?.trim() || formData.installationRef?.trim()) && (
              <section className="grid gap-3 sm:grid-cols-2">
                {formData.productionRef?.trim() ? (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5" /> Referenca proizvodnje
                    </p>
                    <p className="text-sm font-medium">{formData.productionRef}</p>
                  </div>
                ) : null}
                {formData.installationRef?.trim() ? (
                  <div className="rounded-xl border border-border p-4 space-y-1">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Referenca ugradnje
                    </p>
                    <p className="text-sm font-medium">{formData.installationRef}</p>
                  </div>
                ) : null}
              </section>
            )}

            <section className="grid gap-4 sm:grid-cols-2 rounded-xl border border-border bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Dodeljen tim
                </p>
                <p className="text-sm font-medium text-foreground">{readOnlyTeamLabel}</p>
              </div>
              <div className="space-y-1 sm:text-right">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground sm:text-right flex items-center gap-1.5 sm:justify-end">
                  <Calendar className="w-3.5 h-3.5" /> Zakazan datum ugradnje
                </p>
                <p className="text-sm font-medium text-foreground">{formatWoDate(formData.date)}</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Datum kreiranja naloga
                </p>
                <p className="text-sm font-medium text-foreground">
                  {formData.createdAt ? formatWoDateTime(formData.createdAt) : "—"}
                </p>
              </div>
            </section>

            {displayJob && (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Posao i klijent</h3>
                  <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
                    <p className="text-base font-semibold">
                      {displayJob.jobNumber} — {displayJob.customerName || "Kupac"}
                    </p>
                    {"jobStatus" in displayJob && displayJob.jobStatus ? (
                      <p className="text-sm text-muted-foreground">
                        Status posla:{" "}
                        <span className="text-foreground font-medium">{labelJobStatus(displayJob.jobStatus)}</span>
                      </p>
                    ) : null}
                    {"contactPerson" in displayJob && (displayJob as { contactPerson?: string }).contactPerson?.trim() ? (
                      <p className="text-sm text-muted-foreground">
                        Kontakt osoba:{" "}
                        <span className="text-foreground font-medium">
                          {(displayJob as { contactPerson: string }).contactPerson}
                        </span>
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      {jobSummaryPhone ? (
                        <a href={`tel:${jobSummaryPhone}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary">
                          <Phone className="h-4 w-4 shrink-0" /> {jobSummaryPhone}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Telefon: nije unet na poslu / klijentu.</p>
                      )}
                      {jobSummaryEmail ? (
                        <a
                          href={`mailto:${jobSummaryEmail}`}
                          className="inline-flex items-center gap-2 text-sm font-medium text-primary break-all"
                        >
                          <Mail className="h-4 w-4 shrink-0" /> {jobSummaryEmail}
                        </a>
                      ) : null}
                    </div>
                    {"summary" in displayJob && (displayJob as { summary?: string }).summary?.trim() ? (
                      <div className="space-y-1 pt-1">
                        <p className="text-[11px] font-semibold uppercase text-muted-foreground">Sažetak posla</p>
                        <p className="text-sm leading-relaxed text-foreground rounded-lg border border-border bg-muted/40 p-3">
                          {(displayJob as { summary: string }).summary}
                        </p>
                      </div>
                    ) : null}
                    {"billingAddress" in displayJob && (displayJob as { billingAddress?: string }).billingAddress?.trim() ? (
                      <p className="text-sm text-muted-foreground">
                        Adresa za fakturu:{" "}
                        <span className="text-foreground">{(displayJob as { billingAddress: string }).billingAddress}</span>
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            )}

            {quoteLinesLoading ? (
              <p className="text-xs text-muted-foreground">Učitavanje stavki ponude…</p>
            ) : quoteLines && quoteLines.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5" />
                  {formData.type === "installation"
                    ? "Stavke finalne ponude (bez cena)"
                    : "Obuhvat ponude (stavke)"}
                </h3>
                <ul className="rounded-xl border border-border divide-y divide-border bg-card">
                  {quoteLines.map((row) => (
                    <li key={row.id} className="px-4 py-3 text-sm">
                      <span className="text-foreground font-medium">{row.description}</span>
                      <span className="text-muted-foreground tabular-nums"> · količina {row.quantity}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {workInstallationAddress.trim() ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Lokacija ugradnje / teren
                </h3>
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm font-medium text-foreground leading-snug">{workInstallationAddress}</p>
                  <AddressMiniMap
                    address={workInstallationAddress}
                    className="mt-0 h-36 sm:h-40 rounded-lg border border-border/80 bg-background shadow-sm [&_.leaflet-container]:rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto border-primary/30"
                    onClick={() => openInGoogleMaps(workInstallationAddress)}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-2" /> Otvori u Google Mapama
                  </Button>
                </div>
              </section>
            ) : null}

            {formData.type === "production" && effectiveJobId ? (
              <>
                <Separator />
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Proizvodnja i skeniranje bar kodova
                  </h3>
                  <ProductionMaterialTab jobId={effectiveJobId} mode="production" />
                </section>
              </>
            ) : null}

            <DialogFooter className="pt-2 sm:justify-end">
              <Button type="button" onClick={onClose} className="w-full sm:w-auto">
                Zatvori
              </Button>
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
                            const cust0 = Array.isArray(j.customers)
                              ? (j.customers[0] as { phones?: string[] } | undefined)
                              : (j.customers as { phones?: string[] } | null | undefined);
                            const rowPhone = jobPrimaryPhone({
                              customerPhone: (j as { customer_phone?: string | null }).customer_phone ?? null,
                              customer: { phones: cust0?.phones ?? [] },
                            });
                            return (
                              <CommandItem
                                key={j.id}
                                value={`${j.job_number} ${customerName} ${rowPhone}`}
                                onSelect={() => {
                                  setFormData({ ...formData, jobId: j.id });
                                  setJobSelectOpen(false);
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.jobId === j.id ? "opacity-100" : "opacity-0"}`} />
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <span>
                                    {j.job_number} — {customerName}
                                  </span>
                                  {rowPhone ? (
                                    <span className="text-[11px] text-muted-foreground truncate">{rowPhone}</span>
                                  ) : null}
                                </div>
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
            {effectiveJobId ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pregled posla</p>
                {jobDetailsLoading ? (
                  <p className="text-xs text-muted-foreground">Učitavanje podataka o poslu…</p>
                ) : jobDetailsError ? (
                  <p className="text-xs text-destructive">Nije moguće učitati podatke o poslu. Proverite dozvolu ili vezu.</p>
                ) : displayJob ? (
                  <>
                    <div className="font-medium leading-snug">
                      {displayJob.jobNumber} — {displayJob.customerName || "Kupac"}
                    </div>
                    {"jobStatus" in displayJob && displayJob.jobStatus ? (
                      <p className="text-xs text-muted-foreground">
                        Status posla:{" "}
                        <span className="text-foreground font-medium">{labelJobStatus(displayJob.jobStatus)}</span>
                      </p>
                    ) : null}
                    {"contactPerson" in displayJob &&
                    (displayJob as { contactPerson?: string }).contactPerson?.trim() ? (
                      <p className="text-xs text-muted-foreground">
                        Kontakt:{" "}
                        <span className="text-foreground">{(displayJob as { contactPerson: string }).contactPerson}</span>
                      </p>
                    ) : null}
                    {jobSummaryPhone ? (
                      <a
                        href={`tel:${jobSummaryPhone}`}
                        className="flex items-center gap-1.5 text-xs text-primary font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Phone className="h-3 w-3 shrink-0" /> {jobSummaryPhone}
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">Telefon: nije unet na poslu / klijentu.</p>
                    )}
                    {jobSummaryEmail ? (
                      <a
                        href={`mailto:${jobSummaryEmail}`}
                        className="flex items-center gap-1.5 text-xs text-primary font-medium break-all"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Mail className="h-3 w-3 shrink-0" /> {jobSummaryEmail}
                      </a>
                    ) : null}
                    {workInstallationAddress.trim() ? (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="text-foreground">{workInstallationAddress}</span>
                      </div>
                    ) : null}
                    {"summary" in displayJob && (displayJob as { summary?: string }).summary?.trim() ? (
                      <div className="space-y-0.5 pt-0.5">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Sažetak</p>
                        <p className="text-xs leading-relaxed text-foreground border border-border rounded-md p-2 bg-background/80 max-h-24 overflow-y-auto">
                          {(displayJob as { summary: string }).summary}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Nema podataka za izabrani posao.</p>
                )}
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="type">Tip naloga *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: WorkOrderType) => setFormData({ ...formData, type: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tip" />
                </SelectTrigger>
                <SelectContent className="max-h-[min(22rem,var(--radix-select-content-available-height,22rem))]">
                  {WORK_ORDER_TYPE_SELECT_GROUPS.map((g) => (
                    <SelectGroup key={g.heading}>
                      <SelectLabel className="text-xs font-semibold text-foreground px-2 py-1.5" title={g.caption}>
                        {g.heading}
                      </SelectLabel>
                      {g.types.map((t) => (
                        <SelectItem key={t} value={t}>
                          {labelWorkOrderType(t)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
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
              <Label htmlFor="team">{order ? "Dodeljen tim" : "Dodeljen tim *"}</Label>
              <Select
                value={formData.assignedTeamId || undefined}
                onValueChange={(value) => setFormData({ ...formData, assignedTeamId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Izaberite tim" />
                </SelectTrigger>
                <SelectContent>
                  {order ? (
                    <SelectItem value={WORK_ORDER_UNASSIGNED_TEAM}>Neraspoređeno (čeka dodelu)</SelectItem>
                  ) : null}
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

            {formData.type === "production" && (formData.jobId || effectiveJobId) ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Profili i skeniranje bar kodova
                </p>
                <ProductionMaterialTab jobId={formData.jobId || effectiveJobId} mode="production" />
              </div>
            ) : null}
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
