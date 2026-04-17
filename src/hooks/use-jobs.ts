import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Job, JobStatus, JobQuoteLine, Payment } from "@/types";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { isFieldExecutionRole } from "@/lib/field-team-access";
import { formatDateByAppLanguage, getActiveLocaleTag, readAppSettingsCache } from "@/lib/app-settings";
import { MODULE_ACCESS } from "@/config/permissions";
import type { UserRole } from "@/types";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";

const VAT_RATE = 0.2;
const CREATE_JOB_ACTIVITY = { key: "initial-entry", description: "početni unos" } as const;

const JOB_SELECT_MIN = `
  *,
  customers (*),
  payments (amount)
`;

const JOB_SELECT_FULL = `
  *,
  customers (*),
  payments (amount),
  job_quote_lines (*),
  creator:users!jobs_created_by_fkey ( id, name )
`;

async function loadJobsRows(): Promise<Record<string, unknown>[]> {
  const q1 = await supabase.from("jobs").select(JOB_SELECT_FULL).order("created_at", { ascending: false });
  if (!q1.error) return (q1.data ?? []) as Record<string, unknown>[];
  const q2 = await supabase.from("jobs").select(JOB_SELECT_MIN).order("created_at", { ascending: false });
  if (q2.error) throw q2.error;
  return (q2.data ?? []) as Record<string, unknown>[];
}

async function loadJobRow(id: string): Promise<Record<string, unknown>> {
  const q1 = await supabase.from("jobs").select(JOB_SELECT_FULL).eq("id", id).single();
  if (!q1.error && q1.data) return q1.data as Record<string, unknown>;
  const q2 = await supabase.from("jobs").select(JOB_SELECT_MIN).eq("id", id).single();
  if (q2.error) throw q2.error;
  return q2.data as Record<string, unknown>;
}

async function reserveNextJobNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data, error } = await supabase.rpc("next_job_number", {
    p_prefix: prefix,
    p_year: year,
  });

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

function mapQuoteLines(db: Record<string, unknown>): JobQuoteLine[] {
  const raw = db.job_quote_lines;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return [...raw]
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
    .map((row) => ({
      id: row.id as string,
      jobId: row.job_id as string,
      sortOrder: Number(row.sort_order) || 0,
      description: (row.description as string) || "",
      quantity: Number(row.quantity) || 0,
      unitPrice: Number(row.unit_price) || 0,
    }));
}

/** Zbir stavki ponude (količina × jedinična cena), bez dodatnog obračuna PDV-a. */
export function sumQuoteLineAmounts(lines: { quantity?: number; unitPrice?: number }[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

/** Ako je uključeno, dodaje 20% PDV na zbir stavki; inače PDV ostaje 0. */
export function computeJobAmountsFromLineSum(lineSum: number, pricesIncludeVat: boolean) {
  if (lineSum <= 0) return { totalPrice: 0, vatAmount: 0, priceWithoutVat: 0 };
  if (pricesIncludeVat) {
    const priceWithoutVat = Math.round(lineSum * 100) / 100;
    const vatAmount = Math.round(priceWithoutVat * VAT_RATE * 100) / 100;
    const totalPrice = Math.round((priceWithoutVat + vatAmount) * 100) / 100;
    return { totalPrice, vatAmount, priceWithoutVat };
  }
  const totalPrice = Math.round(lineSum * 100) / 100;
  return { totalPrice, vatAmount: 0, priceWithoutVat: totalPrice };
}

// Helper to map DB to UI types
export const mapDbToJob = (db: Record<string, unknown>): Job => {
  const customerData = (Array.isArray(db.customers) ? db.customers[0] : db.customers) as Record<string, unknown> | undefined;

  const totalPrice = Number(db.total_price) || 0;
  const vatAmount = Number(db.vat_amount) || 0;
  const priceWithoutVat = totalPrice - vatAmount;
  const advancePayment = Number(db.advance_payment) || 0;

  const creatorRaw = db.creator as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
  const creatorOne = Array.isArray(creatorRaw) ? creatorRaw[0] : creatorRaw;
  const createdBy =
    creatorOne?.id && creatorOne?.name
      ? { id: String(creatorOne.id), name: String(creatorOne.name) }
      : undefined;

  const jobBill = typeof db.billing_address === "string" ? db.billing_address.trim() : "";
  const jobInst = typeof db.installation_address === "string" ? db.installation_address.trim() : "";

  return {
    id: db.id as string,
    jobNumber: db.job_number as string,
    status: db.status as JobStatus,
    summary: db.summary as string,
    totalPrice,
    vatAmount,
    priceWithoutVat,
    advancePayment,
    unpaidBalance: totalPrice - advancePayment, // This is a fallback, will be updated by payments if available
    createdAt: db.created_at as string,
    statusChangedAt: (db.status_changed_at as string | null | undefined) ?? (db.created_at as string),
    scheduledDate: db.scheduled_date ? formatDateByAppLanguage(db.scheduled_date as string) : undefined,
    pricesIncludeVat: db.prices_include_vat !== false,
    quoteLines: mapQuoteLines(db),
    createdBy,
    statusLocked: db.status_locked === true,
    jobBillingAddress: jobBill || undefined,
    jobInstallationAddress: jobInst || undefined,
    customerPhone: typeof db.customer_phone === "string" ? db.customer_phone.trim() || undefined : undefined,
    customer: customerData
      ? {
          id: customerData.id as string,
          customerNumber: customerData.customer_number as string,
          fullName: customerData.name as string,
          contactPerson: customerData.contact_person as string,
          billingAddress: customerData.billing_address as string,
          installationAddress: customerData.installation_address as string,
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
  const totalPaid = sumPaymentsAmount(db.payments);
  job.advancePayment = totalPaid;
  job.unpaidBalance = job.totalPrice - totalPaid;
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
        .select("id, job_number")
        .order("job_number");
      if (error) throw error;
      return data ?? [];
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
  quoteLines: { description: string; quantity: number; unitPrice: number; sortOrder?: number }[];
  pricesIncludeVat: boolean;
  assignedTeamId?: string;
  advancePayment?: number;
  status?: JobStatus;
  billingAddress?: string;
  installationAddress?: string;
  customerPhone?: string;
}

export interface UpdateJobInput extends CreateJobInput {
  id: string;
}

export function useJobs() {
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, error, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobsList,
  });

  const createJob = useMutation({
    mutationFn: async (newJob: CreateJobInput) => {
      const { jobPrefix } = readAppSettingsCache();
      const jobNumber = await reserveNextJobNumber(jobPrefix);

      const lineSum = sumQuoteLineAmounts(newJob.quoteLines);
      const { totalPrice, vatAmount } = computeJobAmountsFromLineSum(lineSum, newJob.pricesIncludeVat);

      const { data: authData } = await supabase.auth.getUser();
      const createdBy = authData.user?.id ?? null;

      const extendedRow = {
        customer_id: newJob.customerId,
        job_number: jobNumber,
        status: newJob.status || "new",
        summary: newJob.summary,
        team_id: newJob.assignedTeamId || null,
        total_price: totalPrice,
        vat_amount: vatAmount,
        advance_payment: newJob.advancePayment || 0,
        billing_address: newJob.billingAddress,
        installation_address: newJob.installationAddress,
        customer_phone: newJob.customerPhone,
        prices_include_vat: newJob.pricesIncludeVat,
        created_by: createdBy,
      };

      let ins = await supabase.from("jobs").insert([extendedRow]).select("id").single();

      if (ins.error) {
        const legacyRow = {
          customer_id: newJob.customerId,
          job_number: jobNumber,
          status: newJob.status || "new",
          summary: newJob.summary,
          total_price: totalPrice,
          vat_amount: vatAmount,
          advance_payment: newJob.advancePayment || 0,
          billing_address: newJob.billingAddress,
          installation_address: newJob.installationAddress,
          customer_phone: newJob.customerPhone,
        };
        ins = await supabase.from("jobs").insert([legacyRow]).select("id").single();
      }

      if (ins.error) throw ins.error;
      const row = ins.data!;

      if (newJob.quoteLines.length > 0) {
        const { error: linesError } = await supabase.from("job_quote_lines").insert(
          newJob.quoteLines.map((l, i) => ({
            job_id: row.id,
            sort_order: l.sortOrder ?? i,
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unitPrice,
          })),
        );
        if (linesError) {
          const code = (linesError as { code?: string }).code;
          const ign = code === "42P01" || code === "PGRST205";
          if (!ign) throw linesError;
        }
      }

      if (newJob.advancePayment && newJob.advancePayment > 0) {
        const { error: paymentError } = await supabase.from("payments").insert([
          {
            job_id: row.id,
            amount: newJob.advancePayment,
            date: new Date().toISOString().slice(0, 10),
            vat_included: newJob.pricesIncludeVat,
            note: "Avansna uplata pri kreiranju posla",
          },
        ]);

        if (paymentError) {
          console.error("Error creating initial payment record:", paymentError);
        }
      }

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Posao uspešno kreiran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri kreiranju posla", { description: err.message });
    },
  });

  const updateJobStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: JobStatus }) => {
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
          description: `Status promenjen: ${labelJobStatus(previousStatus)} -> ${labelJobStatus(status)}`,
          systemKey: `job-status:${id}:${previousStatus}:${status}`,
          authorId: authData.user?.id ?? null,
        });
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Status posla ažuriran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri ažuriranju statusa", { description: err.message });
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

  const updateJob = useMutation({
    mutationFn: async (updatedJob: UpdateJobInput) => {
      const lineSum = sumQuoteLineAmounts(updatedJob.quoteLines);
      const { totalPrice, vatAmount } = computeJobAmountsFromLineSum(lineSum, updatedJob.pricesIncludeVat);

      const updateRow = {
        customer_id: updatedJob.customerId,
        summary: updatedJob.summary,
        team_id: updatedJob.assignedTeamId || null,
        total_price: totalPrice,
        vat_amount: vatAmount,
        billing_address: updatedJob.billingAddress,
        installation_address: updatedJob.installationAddress,
        customer_phone: updatedJob.customerPhone,
        prices_include_vat: updatedJob.pricesIncludeVat,
      };

      let upd = await supabase.from("jobs").update(updateRow).eq("id", updatedJob.id).select("id").single();
      if (upd.error) {
        const legacyRow = {
          customer_id: updatedJob.customerId,
          summary: updatedJob.summary,
          total_price: totalPrice,
          vat_amount: vatAmount,
          billing_address: updatedJob.billingAddress,
          installation_address: updatedJob.installationAddress,
          customer_phone: updatedJob.customerPhone,
        };
        upd = await supabase.from("jobs").update(legacyRow).eq("id", updatedJob.id).select("id").single();
      }
      if (upd.error) throw upd.error;

      const { error: deleteLinesError } = await supabase.from("job_quote_lines").delete().eq("job_id", updatedJob.id);
      if (deleteLinesError) {
        const code = (deleteLinesError as { code?: string }).code;
        const ign = code === "42P01" || code === "PGRST205";
        if (!ign) throw deleteLinesError;
      }

      if (updatedJob.quoteLines.length > 0) {
        const { error: insertLinesError } = await supabase.from("job_quote_lines").insert(
          updatedJob.quoteLines.map((line, i) => ({
            job_id: updatedJob.id,
            sort_order: line.sortOrder ?? i,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
          })),
        );
        if (insertLinesError) {
          const code = (insertLinesError as { code?: string }).code;
          const ign = code === "42P01" || code === "PGRST205";
          if (!ign) throw insertLinesError;
        }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["jobs-list-minimal"] });
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
    updateJobStatus,
    toggleJobStatusLock,
    deleteJob,
  };
}

export function useJobDetails(id: string | undefined) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      if (!id) return null;
      const data = await loadJobRow(id);

      const job = mapDbToJob(data);
      return applyPaymentsToJob(job, data);
    },
    enabled: !!id,
  });
}

export function useFinancesData() {
  const { user } = useAuthStore();
  const skipForFieldRoles = isFieldExecutionRole(user?.role);

  return useQuery({
    queryKey: ["finances-summary"],
    enabled: !skipForFieldRoles,
    queryFn: async () => {
      const { data: jobsData, error: jobsError } = await supabase
        .from("jobs")
        .select(`
          total_price,
          payments (amount, date)
        `);

      if (jobsError) throw jobsError;

      const totalRevenue = jobsData.reduce((s, j) => s + (Number(j.total_price) || 0), 0);
      
      const allPayments = jobsData.flatMap(j => Array.isArray(j.payments) ? j.payments : []);
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
        totalRevenue,
        totalPaid,
        totalUnpaid,
        collectionRate,
        monthlyCollectionData,
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
        const lateDeliveries = list
          .filter(
            m =>
              m.delivery_status !== "delivered" &&
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
        return (activities ?? []).map(act => {
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
