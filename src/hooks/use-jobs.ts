import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Job, JobStatus, Payment } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { formatDateByAppLanguage, getActiveLocaleTag, readAppSettingsCache } from "@/lib/app-settings";
import { MODULE_ACCESS } from "@/config/permissions";
import type { UserRole } from "@/types";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";
import { ensureWorkflowWorkOrders } from "@/lib/work-order-workflow-automation";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import {
  computeJobAmountsFromLineSum,
  normalizeVatRatePercent,
  sumQuoteLineAmounts,
  vatAmountsFromTotalDue,
} from "@/lib/job-pricing";
import { DEFAULT_OUTGOING_VAT_RATE_PERCENT } from "@/lib/vat-constants";
import { applyQuotePricesFromJob } from "@/lib/sync-job-from-quote";

export { computeJobAmountsFromLineSum, sumQuoteLineAmounts } from "@/lib/job-pricing";

const CREATE_JOB_ACTIVITY = { key: "initial-entry", description: "početni unos" } as const;

/**
 * Embed kreatora na celu listu poslova (fetchJobsList) dovodi do statement timeout-a na Postgresu —
 * RLs + mnogo redova × join na users. Lista koristi kolonu `created_by_name` sa reda jobs.
 * Ovaj embed ide samo u loadJobRow (jedan posao).
 */
const JOB_CREATOR_EMBED = `
  creator:users!created_by (
    id,
    name,
    full_name,
    email
  )
`;

const JOB_SELECT_MIN = `
  *,
  customers (*),
  payments (id, amount, date, vat_included, note)
`;

const JOB_SELECT_FULL = JOB_SELECT_MIN;

/** Samo posao + klijent (fallback ako JOIN na uplate izazove grešku). */
const JOB_SELECT_CORE = `
  *,
  customers (*)
`;

const JOB_SELECT_MIN_WITH_CREATOR = `${JOB_SELECT_MIN.trim()},
  ${JOB_CREATOR_EMBED.trim()}
`;

const JOB_SELECT_FULL_WITH_CREATOR = `${JOB_SELECT_FULL.trim()},
  ${JOB_CREATOR_EMBED.trim()}
`;

const JOB_SELECT_CORE_WITH_CREATOR = `${JOB_SELECT_CORE.trim()},
  ${JOB_CREATOR_EMBED.trim()}
`;

async function loadJobsRows(): Promise<Record<string, unknown>[]> {
  const q1 = await supabase.from("jobs").select(JOB_SELECT_FULL).order("created_at", { ascending: false });
  if (!q1.error) return (q1.data ?? []) as Record<string, unknown>[];
  const q2 = await supabase.from("jobs").select(JOB_SELECT_MIN).order("created_at", { ascending: false });
  if (!q2.error) return (q2.data ?? []) as Record<string, unknown>[];
  const q3 = await supabase.from("jobs").select(JOB_SELECT_CORE).order("created_at", { ascending: false });
  if (!q3.error) return (q3.data ?? []) as Record<string, unknown>[];
  const q4 = await supabase.from("jobs").select("*").order("created_at", { ascending: false });
  if (!q4.error) return (q4.data ?? []) as Record<string, unknown>[];
  throw q4.error;
}

async function loadJobRow(id: string): Promise<Record<string, unknown>> {
  const q1 = await supabase.from("jobs").select(JOB_SELECT_FULL_WITH_CREATOR).eq("id", id).maybeSingle();
  if (!q1.error && q1.data) return q1.data as unknown as Record<string, unknown>;
  const q2 = await supabase.from("jobs").select(JOB_SELECT_MIN_WITH_CREATOR).eq("id", id).maybeSingle();
  if (!q2.error && q2.data) return q2.data as unknown as Record<string, unknown>;
  const q3 = await supabase.from("jobs").select(JOB_SELECT_CORE_WITH_CREATOR).eq("id", id).maybeSingle();
  if (!q3.error && q3.data) return q3.data as unknown as Record<string, unknown>;
  const q4 = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
  if (!q4.error && q4.data) return q4.data as Record<string, unknown>;
  if (q4.error) throw q4.error;
  throw new Error("Posao nije pronađen ili nemate pristup tom zapisu.");
}

function removeMissingJobsColumnFromRow(
  row: Record<string, unknown>,
  error: { message?: string; details?: string; hint?: string } | null,
): Record<string, unknown> | null {
  if (!error) return null;
  const raw = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  const match = raw.match(/'([^']+)'/);
  const missingColumn = match?.[1];
  if (!missingColumn || !(missingColumn in row)) return null;
  const next = { ...row };
  delete next[missingColumn];
  return next;
}

async function insertJobWithCompatibility(row: Record<string, unknown>) {
  let attemptRow: Record<string, unknown> | null = { ...row };
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4 && attemptRow; attempt += 1) {
    const ins = await supabase.from("jobs").insert([attemptRow]).select("id").single();
    if (!ins.error) return ins;
    lastError = ins.error;
    attemptRow = removeMissingJobsColumnFromRow(
      attemptRow,
      ins.error as { message?: string; details?: string; hint?: string } | null,
    );
  }

  throw lastError instanceof Error ? lastError : new Error("Neuspešno kreiranje posla.");
}

async function reserveNextJobNumber(): Promise<string> {
  const { data, error } = await supabase.rpc("next_job_number");

  if (error || typeof data !== "string" || data.trim().length === 0) {
    throw new Error("Nije moguće dobiti sledeći broj posla preko RPC funkcije `next_job_number`.");
  }

  return data;
}

async function ensureInitialJobActivities(jobId: string, authorId: string | null): Promise<number> {
  await upsertSystemActivity({
    jobId,
    description: CREATE_JOB_ACTIVITY.description,
    systemKey: CREATE_JOB_ACTIVITY.key,
    authorId,
  });
  return 1;
}

// Helper to map DB to UI types
export const mapDbToJob = (db: Record<string, unknown>): Job => {
  const customerData = (Array.isArray(db.customers) ? db.customers[0] : db.customers) as Record<string, unknown> | undefined;

  const totalPrice = Number(db.total_price) || 0;
  const vatAmount = Number(db.vat_amount) || 0;
  const priceWithoutVat = totalPrice - vatAmount;
  const advancePayment = Number(db.advance_payment) || 0;

  const createdByIdRaw = db.created_by;
  const createdById =
    typeof createdByIdRaw === "string" && createdByIdRaw.length > 0
      ? createdByIdRaw
      : typeof createdByIdRaw === "number"
        ? String(createdByIdRaw)
        : null;

  const snapshot =
    typeof db.created_by_name === "string" ? db.created_by_name.trim() : "";

  const creatorRaw = db.creator as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const creatorOne = Array.isArray(creatorRaw) ? creatorRaw[0] : creatorRaw;
  const fromEmbed = (() => {
    const full = typeof creatorOne?.full_name === "string" ? creatorOne.full_name.trim() : "";
    const short = typeof creatorOne?.name === "string" ? creatorOne.name.trim() : "";
    const mail = typeof creatorOne?.email === "string" ? creatorOne.email.trim() : "";
    return full || short || mail || "";
  })();

  const displayName = snapshot || fromEmbed;
  const createdBy =
    createdById && displayName
      ? { id: createdById, name: displayName }
      : createdById
        ? { id: createdById, name: "Nepoznat korisnik" }
        : undefined;

  const jobBill = typeof db.billing_address === "string" ? db.billing_address.trim() : "";
  const jobInst = typeof db.installation_address === "string" ? db.installation_address.trim() : "";
  const jobInstApt =
    typeof db.installation_apartment === "string" ? db.installation_apartment.trim() : "";
  const jobInstFloor = typeof db.installation_floor === "string" ? db.installation_floor.trim() : "";
  const estRaw = db.estimated_installation_hours;
  const estParsed =
    estRaw === null || estRaw === undefined
      ? undefined
      : typeof estRaw === "number"
        ? estRaw
        : Number(estRaw);
  const estimatedInstallationHours = Number.isFinite(estParsed) ? estParsed : undefined;

  const parentJobIdRaw = db.parent_job_id;
  const parentJobId =
    typeof parentJobIdRaw === "string" && parentJobIdRaw.length > 0 ? parentJobIdRaw : undefined;

  return {
    id: db.id as string,
    jobNumber: db.job_number as string,
    parentJobId,
    status: db.status as JobStatus,
    summary: db.summary as string,
    totalPrice,
    vatAmount,
    priceWithoutVat,
    advancePayment,
    unpaidBalance: totalPrice - advancePayment, // This is a fallback, will be updated by payments if available
    createdAt: db.created_at as string,
    statusChangedAt: (db.status_changed_at as string | null | undefined) ?? (db.created_at as string),
    scheduledAt:
      typeof db.scheduled_date === "string" && db.scheduled_date.trim()
        ? db.scheduled_date.trim()
        : undefined,
    scheduledDate: db.scheduled_date ? formatDateByAppLanguage(db.scheduled_date as string) : undefined,
    pricesIncludeVat: db.prices_include_vat !== false,
    vatRatePercent: normalizeVatRatePercent(db.vat_rate_percent),
    quoteLines: [],
    createdBy,
    statusLocked: db.status_locked === true,
    jobBillingAddress: jobBill || undefined,
    jobInstallationAddress: jobInst || undefined,
    jobInstallationApartment: jobInstApt || undefined,
    jobInstallationFloor: jobInstFloor || undefined,
    customerPhone: typeof db.customer_phone === "string" ? db.customer_phone.trim() || undefined : undefined,
    firstCompletedAt:
      typeof db.first_completed_at === "string" && db.first_completed_at
        ? db.first_completed_at
        : db.first_completed_at === null
          ? null
          : undefined,
    estimatedInstallationHours,
    postMeasurementKeepInitialQuote: db.post_measurement_keep_initial_quote === true,
    customer: customerData
      ? {
          id: customerData.id as string,
          customerNumber: customerData.customer_number as string,
          fullName: customerData.name as string,
          contactPerson: customerData.contact_person as string,
          billingAddress: customerData.billing_address as string,
          installationAddress: customerData.installation_address as string,
          installationApartment:
            typeof customerData.installation_apartment === "string"
              ? customerData.installation_apartment.trim() || undefined
              : undefined,
          installationFloor:
            typeof customerData.installation_floor === "string"
              ? customerData.installation_floor.trim() || undefined
              : undefined,
          phones: (customerData.phones as string[]) || [],
          emails: (customerData.emails as string[]) || [],
          pib: customerData.pib as string,
          registrationNumber: customerData.registration_number as string,
          createdAt: customerData.created_at as string,
        }
      : {
          id: "",
          customerNumber: "",
          fullName: "Nepoznat klijent",
          contactPerson: "",
          billingAddress: "",
          installationAddress: "",
          phones: [],
          emails: [],
          pib: "",
          registrationNumber: "",
          createdAt: "",
        },
  };
};

function sumPaymentsAmount(payments: unknown): number {
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, payment) => {
    const amount = Number((payment as { amount?: unknown }).amount) || 0;
    return sum + amount;
  }, 0);
}

function applyPaymentsToJob(job: Job, db: Record<string, unknown>): Job {
  const rawPayments = Array.isArray(db.payments) ? db.payments : [];
  const payments = rawPayments
    .map((row) => {
      const p = row as Record<string, unknown>;
      const id = typeof p.id === "string" ? p.id : "";
      const date = typeof p.date === "string" ? p.date : "";
      if (!id || !date) return null;
      return {
        id,
        jobId: job.id,
        amount: Number(p.amount) || 0,
        date,
        includesVat: p.vat_included !== false,
        note: typeof p.note === "string" ? p.note : undefined,
      } as Payment;
    })
    .filter((p): p is Payment => !!p);
  const totalPaid = sumPaymentsAmount(rawPayments);
  job.advancePayment = totalPaid;
  job.unpaidBalance = job.totalPrice - totalPaid;
  job.payments = payments;
  return job;
}

export async function fetchJobsList(): Promise<Job[]> {
  const data = await loadJobsRows();
  return data.map((db) => {
    const job = mapDbToJob(db);
    return applyPaymentsToJob(job, db);
  });
}

export function useJobsListSimple() {
  return useQuery({
    queryKey: ["jobs-list-simple"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, job_number, summary, status, customers(id, name)")
        .order("job_number");
      if (error) throw error;
      return (data ?? []).map((d: any) => ({
        id: d.id,
        job_number: d.job_number,
        summary: d.summary || "",
        status: d.status,
        customer: d.customers ? { id: d.customers.id, fullName: d.customers.name } : undefined,
      }));
    },
  });
}

export async function fetchJobByIdForExport(id: string): Promise<Job | null> {
  try {
    const data = await loadJobRow(id);
    const job = mapDbToJob(data);
    return applyPaymentsToJob(job, data);
  } catch {
    return null;
  }
}

export interface CreateJobInput {
  customerId: string;
  summary: string;
  assignedTeamId?: string;
  billingAddress?: string;
  installationAddress?: string;
  installationApartment?: string;
  installationFloor?: string;
  customerPhone?: string;
}

export interface UpdateJobInput extends CreateJobInput {
  id: string;
}

export interface UpdateJobPricingInput {
  id: string;
  /** Iznos za naplatu (ukupna cena koja se knjiži na poslu). */
  totalDue: number;
  pricesIncludeVat: boolean;
  vatRatePercent: number;
}

export function useJobs() {
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, error, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobsList,
  });

  const createJob = useMutation({
    mutationFn: async (newJob: CreateJobInput) => {
      const jobNumber = await reserveNextJobNumber();

      const { data: authData } = await supabase.auth.getUser();
      const createdBy = authData.user?.id ?? null;

      const insertRow = {
        customer_id: newJob.customerId,
        job_number: jobNumber,
        status: "new" satisfies JobStatus,
        summary: newJob.summary,
        team_id: newJob.assignedTeamId || null,
        total_price: 0,
        vat_amount: 0,
        advance_payment: 0,
        billing_address: newJob.billingAddress,
        installation_address: newJob.installationAddress,
        installation_apartment: newJob.installationApartment?.trim() || null,
        installation_floor: newJob.installationFloor?.trim() || null,
        customer_phone: newJob.customerPhone,
        prices_include_vat: true,
        vat_rate_percent: DEFAULT_OUTGOING_VAT_RATE_PERCENT,
        created_by: createdBy,
      };

      const ins = await insertJobWithCompatibility(insertRow);
      const row = ins.data!;

      try {
        const ensuredCount = await ensureInitialJobActivities(row.id, createdBy);
        if (ensuredCount < 1) {
          toast.warning("Posao je kreiran, ali početna aktivnost nije automatski dodata.", {
            description: "Dodato 0/1.",
          });
        }
      } catch (activitiesError) {
        console.error("Error creating initial activities:", activitiesError);
        const description =
          typeof activitiesError === "object" &&
          activitiesError !== null &&
          "message" in activitiesError &&
          typeof (activitiesError as { message?: unknown }).message === "string"
            ? (activitiesError as { message: string }).message
            : "Proverite RLS/politike i migracije za tabelu activities.";
        toast.warning("Posao je kreiran, ali početne aktivnosti nisu automatski dodate.", {
          description,
        });
      }

      const full = await loadJobRow(row.id);
      return mapDbToJob(full);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
      queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      if (data?.id) {
        void queryClient.invalidateQueries({ queryKey: ["quotes", data.id] });
        void queryClient.invalidateQueries({ queryKey: ["files", data.id] });
      }
      void queryClient.invalidateQueries({ queryKey: ["files", "all"] });
      invalidateFilesStorageUsage(queryClient);
      toast.success("Posao uspešno kreiran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri kreiranju posla", { description: err.message });
    },
  });

  const updateJobStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobStatus }) => {
      if (status === "completed") {
        const [{ data: jobData, error: jobTotalsError }, { data: paymentsData, error: paymentsError }] =
          await Promise.all([
            supabase.from("jobs").select("total_price").eq("id", id).single(),
            supabase.from("payments").select("amount").eq("job_id", id),
          ]);
        if (jobTotalsError) throw jobTotalsError;
        if (paymentsError) throw paymentsError;
        const totalPrice = Number(jobData?.total_price) || 0;
        const totalPaid = (paymentsData ?? []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        const unpaidBalance = totalPrice - totalPaid;
        if (unpaidBalance > 0.009) {
          throw new Error("Status ne može na „Završen“ dok posao nije u potpunosti isplaćen.");
        }
      }

      const before = await supabase.from("jobs").select("status").eq("id", id).single();
      if (before.error) throw before.error;
      const previousStatus = before.data?.status as JobStatus | undefined;
      const { error } = await supabase
        .from("jobs")
        .update({ status })
        .eq("id", id);

      if (error) throw error;
      if (previousStatus && previousStatus !== status) {
        const { data: authData } = await supabase.auth.getUser();
        await upsertSystemActivity({
          jobId: id,
          description: `Status promenjen: ${labelJobStatus(previousStatus)} → ${labelJobStatus(status)}`,
          systemKey: `job-status:${id}:${previousStatus}:${status}`,
          authorId: authData.user?.id ?? null,
        });
      }
      try {
        await ensureWorkflowWorkOrders(id);
      } catch (e) {
        console.warn("ensureWorkflowWorkOrders posle promene statusa posla:", e);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Status posla ažuriran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri ažuriranju statusa", { description: err.message });
    },
  });

  const confirmJobProductionDone = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.rpc("confirm_job_production_done", { p_job_id: id });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Proizvodnja je označena kao završena");
    },
    onError: (err: Error) => {
      toast.error("Greška pri potvrdi završetka proizvodnje", { description: err.message });
    },
  });

  const toggleJobStatusLock = useMutation({
    mutationFn: async ({ id, locked }: { id: string; locked: boolean }) => {
      const { error } = await supabase
        .from("jobs")
        .update({ status_locked: locked })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      toast.success(variables.locked ? "Automatski status je zaključan" : "Automatski status je otključan");
    },
    onError: (err: Error) => {
      toast.error("Greška pri promeni zaključavanja statusa", { description: err.message });
    },
  });

  const updateJobPricing = useMutation({
    mutationFn: async (input: UpdateJobPricingInput) => {
      const totalDue = Number(input.totalDue);
      if (!Number.isFinite(totalDue) || totalDue < 0) {
        throw new Error("Ukupan iznos nije validan.");
      }
      const rate = normalizeVatRatePercent(input.vatRatePercent);
      const pi = Boolean(input.pricesIncludeVat);
      const { totalPrice, vatAmount } =
        totalDue <= 0
          ? { totalPrice: 0, vatAmount: 0 }
          : rate === 0
            ? vatAmountsFromTotalDue(totalDue, 0)
            : pi
              ? vatAmountsFromTotalDue(totalDue, rate)
              : computeJobAmountsFromLineSum(totalDue, false, rate);
      const { error } = await supabase
        .from("jobs")
        .update({
          total_price: totalPrice,
          vat_amount: vatAmount,
          prices_include_vat: pi,
          vat_rate_percent: rate,
        })
        .eq("id", input.id);
      if (error) throw error;

      const quoteSync = await applyQuotePricesFromJob({
        jobId: input.id,
        totalAmount: totalDue,
        pricesIncludeVat: pi,
        vatRatePercent: rate,
      });
      if (!quoteSync.ok) {
        throw new Error(quoteSync.error);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      toast.success("Cena posla je sačuvana");
    },
    onError: (err: Error) => {
      toast.error("Greška pri čuvanju cene", { description: err.message });
    },
  });

  const updateJob = useMutation({
    mutationFn: async (updatedJob: UpdateJobInput) => {
      const updateRow: Record<string, unknown> = {
        customer_id: updatedJob.customerId,
        summary: updatedJob.summary,
        billing_address: updatedJob.billingAddress,
        installation_address: updatedJob.installationAddress,
        installation_apartment: updatedJob.installationApartment?.trim() || null,
        installation_floor: updatedJob.installationFloor?.trim() || null,
        customer_phone: updatedJob.customerPhone,
      };
      if (Object.prototype.hasOwnProperty.call(updatedJob, "assignedTeamId")) {
        updateRow.team_id = updatedJob.assignedTeamId || null;
      }

      let upd = await supabase.from("jobs").update(updateRow).eq("id", updatedJob.id).select("id").single();
      if (upd.error) {
        const legacyRow = {
          customer_id: updatedJob.customerId,
          summary: updatedJob.summary,
          billing_address: updatedJob.billingAddress,
          installation_address: updatedJob.installationAddress,
          customer_phone: updatedJob.customerPhone,
        };
        upd = await supabase.from("jobs").update(legacyRow).eq("id", updatedJob.id).select("id").single();
      }
      if (upd.error) throw upd.error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
      queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      toast.success("Posao uspešno izmenjen");
    },
    onError: (err: Error) => {
      toast.error("Greška pri izmeni posla", { description: err.message });
    },
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["completed-jobs-map"] });
      queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      toast.success("Posao obrisan");
    },
    onError: (err: Error) => {
      toast.error("Greška pri brisanju posla", { description: err.message });
    },
  });

  return {
    jobs,
    isLoading,
    error,
    refetch,
    createJob,
    updateJob,
    updateJobPricing,
    updateJobStatus,
    confirmJobProductionDone,
    toggleJobStatusLock,
    deleteJob,
  };
}

export function useJobDetails(id: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!id) return;

    const invalidateDetails = () => {
      void queryClient.invalidateQueries({ queryKey: ["job", id] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["work-orders", id] });
      void queryClient.invalidateQueries({ queryKey: ["field-reports", id] });
      void queryClient.invalidateQueries({ queryKey: ["quotes", id] });
      void queryClient.invalidateQueries({ queryKey: ["activities", id] });
      void queryClient.invalidateQueries({ queryKey: ["payments", id] });
      void queryClient.invalidateQueries({ queryKey: ["files", id] });
    };

    const jobsChannel = supabase
      .channel(`job-details-live:jobs:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${id}` }, invalidateDetails)
      .subscribe();

    const paymentsChannel = supabase
      .channel(`job-details-live:payments:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `job_id=eq.${id}` }, invalidateDetails)
      .subscribe();

    const workOrdersChannel = supabase
      .channel(`job-details-live:work-orders:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `job_id=eq.${id}` }, invalidateDetails)
      .subscribe();

    const fieldReportsChannel = supabase
      .channel(`job-details-live:field-reports:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "field_reports", filter: `job_id=eq.${id}` }, invalidateDetails)
      .subscribe();

    return () => {
      void supabase.removeChannel(jobsChannel);
      void supabase.removeChannel(paymentsChannel);
      void supabase.removeChannel(workOrdersChannel);
      void supabase.removeChannel(fieldReportsChannel);
    };
  }, [id, queryClient]);

  return useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      if (!id) return null;
      const data = await loadJobRow(id);

      const job = mapDbToJob(data);
      return applyPaymentsToJob(job, data);
    },
    enabled: !!id,
    /** Detail stranica mora odmah da odražava promene (npr. RPC status); globalni staleTime 5min je predug. */
    staleTime: 0,
  });
}

export function useFinancesData() {
  const { user } = useAuthStore();
  const skipForFieldRoles = isFieldExecutionRole(user?.role);
  const canSeeSummary = user?.role === "admin" || user?.role === "finance" || user?.role === "office";

  return useQuery({
    queryKey: ["finances-summary"],
    enabled: !skipForFieldRoles && canSeeSummary,
    queryFn: async () => {
      const [{ data: jobsData, error: jobsError }, { data: moVatRows, error: moError }] = await Promise.all([
        supabase.from("jobs").select(`
          status,
          total_price,
          vat_amount,
          vat_rate_percent,
          payments (amount, date)
        `),
        supabase.from("material_orders").select("supplier_incoming_vat_amount"),
      ]);

      if (jobsError) throw jobsError;
      if (moError) throw moError;

      const rows = jobsData ?? [];
      const estimatedTotal = rows.reduce((s, j) => s + (Number(j.total_price) || 0), 0);

      /**
       * Finansijski aktivno = posao ima cenu i nije draft/otkazan.
       * Time KPI i graf pokrivaju i faze ponude (`quote_sent`, `final_quote_sent`),
       * umesto da ostanu 0 dok posao još nije "accepted".
       */
      const excludedStatuses = new Set(["new", "canceled"]);
      const financiallyActiveJobs = rows.filter((j) => {
        const totalPrice = Number(j.total_price) || 0;
        const status = String(j.status ?? "");
        return totalPrice > 0.009 && !excludedStatuses.has(status);
      });
      const totalRevenue = financiallyActiveJobs.reduce((s, j) => s + (Number(j.total_price) || 0), 0);

      const totalOutgoingVatReport = financiallyActiveJobs.reduce(
        (s, j) => s + (Number((j as { vat_amount?: unknown }).vat_amount) || 0),
        0,
      );
      const totalIncomingVatReport = (moVatRows ?? []).reduce(
        (s, row) => s + (Number((row as { supplier_incoming_vat_amount?: unknown }).supplier_incoming_vat_amount) || 0),
        0,
      );
      const estimatedVatLiability = Math.round((totalOutgoingVatReport - totalIncomingVatReport) * 100) / 100;

      const allPayments = financiallyActiveJobs.flatMap(j => Array.isArray(j.payments) ? j.payments : []);
      const totalPaid = allPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      
      const totalUnpaid = totalRevenue - totalPaid;
      const collectionRate = totalRevenue > 0 ? Math.round((totalPaid / totalRevenue) * 100) : 0;

      // Group payments by month for chart
      const monthlyDataMap: Map<string, { label: string; amount: number; sortKey: string }> = new Map();
      allPayments.forEach(p => {
        const date = new Date(p.date);
        const label = date.toLocaleDateString(getActiveLocaleTag(), { month: "short", year: "2-digit" });
        const sortKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
        
        const existing = monthlyDataMap.get(sortKey) || { label, amount: 0, sortKey };
        existing.amount += Number(p.amount) || 0;
        monthlyDataMap.set(sortKey, existing);
      });

      const monthlyCollectionData = Array.from(monthlyDataMap.values())
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map(item => ({ month: item.label, naplaćeno: item.amount }));

      return {
        estimatedTotal,
        totalRevenue,
        totalPaid,
        totalUnpaid,
        collectionRate,
        monthlyCollectionData,
        totalOutgoingVatReport,
        totalIncomingVatReport,
        estimatedVatLiability,
      };
    },
  });
}

export function useDashboardStats() {
  const { user } = useAuthStore();
  const skipForFieldRoles = isFieldExecutionRole(user?.role);
  const role = user?.role as UserRole | undefined;
  const modules = role ? (MODULE_ACCESS[role] ?? []) : [];

  return useQuery({
    queryKey: ["dashboard-stats", role],
    enabled: !skipForFieldRoles && !!role,
    queryFn: async () => {
      const empty = {
        pendingOrders: 0,
        lateDeliveriesCount: 0,
        lateDeliveries: [] as {
          id: string;
          jobId: string;
          materialType: string;
          supplier: string;
          expectedDelivery: string;
          jobNumber?: string;
        }[],
        upcomingInstallations: 0,
        lastActivities: [] as {
          id: string;
          jobId: string;
          jobNumber?: string;
          type: string;
          description: string;
          createdBy: string;
          createdAt: string;
        }[],
      };

      const fetchMaterial = async () => {
        const { data: materialOrders, error: moError } = await supabase
          .from("material_orders")
          .select(`
            id,
            job_id,
            material_type,
            supplier,
            delivery_status,
            expected_delivery_date,
            jobs (job_number)
          `);
        if (moError) throw moError;
        const list = materialOrders ?? [];
        const pendingOrders = list.filter(m => m.delivery_status === "pending").length;
        // Statusi gde je materijal već stigao (sa ili bez reklamacije) — ne računaju se kao kašnjenje.
        const RECEIVED_STATUSES = new Set([
          "delivered",
          "partial",
          "materials_received",
          "received_with_issues",
        ]);
        const lateDeliveries = list
          .filter(
            m =>
              !RECEIVED_STATUSES.has(m.delivery_status) &&
              m.expected_delivery_date &&
              new Date(m.expected_delivery_date) < new Date(),
          )
          .map(m => {
            const jobData = Array.isArray(m.jobs) ? m.jobs[0] : m.jobs;
            return {
              id: m.id,
              jobId: m.job_id,
              materialType: m.material_type,
              supplier: m.supplier,
              expectedDelivery: m.expected_delivery_date
                ? formatDateByAppLanguage(m.expected_delivery_date)
                : "N/A",
              jobNumber: jobData?.job_number,
            };
          });
        return { pendingOrders, lateDeliveries };
      };

      const fetchInstallations = async () => {
        const { data: workOrders, error: woError } = await supabase
          .from("work_orders")
          .select("type, status, date")
          .eq("type", "installation")
          .eq("status", "pending");
        if (woError) throw woError;
        return (workOrders ?? []).length;
      };

      const fetchActivities = async () => {
        const { data: activities, error: actError } = await supabase
          .from("activities")
          .select(`
            *,
            users (name),
            jobs (job_number)
          `)
          .order("date", { ascending: false })
          .limit(5);
        if (actError) throw actError;
        const filtered =
          role === "office"
            ? (activities ?? []).filter((act) => {
                const sk = typeof act.system_key === "string" ? act.system_key.toLowerCase() : "";
                if (sk.startsWith("material-order-")) return false;
                const d = typeof act.description === "string" ? act.description.toLowerCase() : "";
                if (d.includes("prilog narudžbine materijala")) return false;
                if (d.includes("prilog narudzbine materijala")) return false;
                return true;
              })
            : (activities ?? []);

        return filtered.map(act => {
          const userData = Array.isArray(act.users) ? act.users[0] : act.users;
          const jobData = Array.isArray(act.jobs) ? act.jobs[0] : act.jobs;
          return {
            id: act.id,
            jobId: act.job_id,
            jobNumber: jobData?.job_number,
            type: act.type,
            description: act.description,
            createdBy: userData?.name || "Sistem",
            createdAt: act.date,
          };
        });
      };

      const materialP = modules.includes("material-orders")
        ? fetchMaterial()
        : Promise.resolve({ pendingOrders: 0, lateDeliveries: [] as typeof empty.lateDeliveries });
      const workP = modules.includes("work-orders")
        ? fetchInstallations()
        : Promise.resolve(0);
      const actP = modules.includes("activities")
        ? fetchActivities()
        : Promise.resolve(empty.lastActivities);

      const [matR, workR, actR] = await Promise.allSettled([materialP, workP, actP]);

      let pendingOrders = empty.pendingOrders;
      let lateDeliveries = empty.lateDeliveries;
      if (matR.status === "fulfilled") {
        pendingOrders = matR.value.pendingOrders;
        lateDeliveries = matR.value.lateDeliveries;
      } else {
        console.warn("[dashboard-stats] material_orders", matR.reason);
      }

      let upcomingInstallations = empty.upcomingInstallations;
      if (workR.status === "fulfilled") {
        upcomingInstallations = workR.value;
      } else {
        console.warn("[dashboard-stats] work_orders", workR.reason);
      }

      let lastActivities = empty.lastActivities;
      if (actR.status === "fulfilled") {
        lastActivities = actR.value;
      } else {
        console.warn("[dashboard-stats] activities", actR.reason);
      }

      return {
        pendingOrders,
        lateDeliveriesCount: lateDeliveries.length,
        lateDeliveries,
        upcomingInstallations,
        lastActivities,
      };
    },
  });
}
