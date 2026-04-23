import { supabase } from "@/lib/supabase";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";
import type { JobStatus, QuoteStatus, WorkOrderType } from "@/types";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";

type WorkOrderStatus = "pending" | "in_progress" | "completed" | "canceled";

type WorkOrderRow = { id?: string; status: WorkOrderStatus; type: WorkOrderType };
type MaterialOrderDeliveryStatus = "pending" | "shipped" | "delivered" | "partial";
type MaterialOrderRow = { delivery_status: MaterialOrderDeliveryStatus };
type QuoteRow = {
  status: QuoteStatus;
  created_at?: string | null;
  updated_at?: string | null;
  version_number?: number | null;
};
type FieldReportRow = {
  work_order_id: string | null;
  everything_ok: boolean | null;
  site_canceled: boolean | null;
  completed: boolean | null;
  created_at?: string | null;
  details?: { arrivedAt?: string; canceledAt?: string; finishedAt?: string } | null;
};

/** Statusi koje automatska pravila ne menjaju dok su aktivni (ručni režimi). */
const PRESERVED_MANUAL_AUTOMATION_STATUSES = new Set<JobStatus>([
  "service",
  "canceled",
]);

function automationSkipsRecompute(current: JobStatus): boolean {
  return PRESERVED_MANUAL_AUTOMATION_STATUSES.has(current);
}

function isMissingTableError(code?: string) {
  return code === "42P01" || code === "PGRST205";
}

/** PostgREST uses PGRST202 when the RPC is not in the schema cache / not found. */
function isMissingRpcError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42883" || e.code === "PGRST202") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return msg.includes("recompute_job_status") && msg.includes("Could not find");
}

function terminalWo(s: WorkOrderStatus): boolean {
  return s === "completed" || s === "canceled";
}

type DeriveStatusResult = { status: JobStatus; reason: string };

type JobStatusDeriveContext = {
  workOrders: WorkOrderRow[];
  quotes: QuoteRow[];
  materialOrders: MaterialOrderRow[];
  fieldReports: FieldReportRow[];
  hasAdvancePayment: boolean;
  totalPrice: number;
  totalPaid: number;
};

/**
 * Centralna status logika (FAZA 2) sa prioritetima i razlogom promene.
 */
export function deriveJobStatus(current: JobStatus, context: JobStatusDeriveContext): DeriveStatusResult {
  if (automationSkipsRecompute(current)) {
    return { status: current, reason: "Manual status override preserved" };
  }

  const wos = context.workOrders;
  const quotes = context.quotes;
  const materialOrders = context.materialOrders;
  const reports = context.fieldReports;
  const unpaidBalance = Number(context.totalPrice) - Number(context.totalPaid);

  const canceledByField = reports.some((r) => r.site_canceled === true);
  const hasActiveWorkflow = wos.some((w) => w.status !== "completed" && w.status !== "canceled");
  if (canceledByField && !hasActiveWorkflow) {
    return { status: "canceled", reason: "Site canceled without continuation" };
  }

  const isComplaintOpen = wos.some((w) => w.type === "complaint" && w.status !== "completed" && w.status !== "canceled");
  if (isComplaintOpen) return { status: "complaint", reason: "Complaint work order opened" };

  const isServiceOpen = wos.some((w) => w.type === "service" && w.status !== "completed" && w.status !== "canceled");
  if (isServiceOpen) return { status: "service", reason: "Service work order opened" };

  const measTypes = MEASUREMENT_WORK_ORDER_TYPES as readonly WorkOrderType[];
  const hasMeas = wos.some((w) => measTypes.includes(w.type));
  const measUnfinished = wos.some((w) => measTypes.includes(w.type) && !terminalWo(w.status));
  const measurementWorkOrdersCompleted = wos.some(
    (w) => measTypes.includes(w.type) && w.status === "completed",
  );
  const hasProd = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE);
  const measurementReportsCompleted = reports.some(
    (r) =>
      r.completed === true &&
      wos.some((w) => w.id === r.work_order_id && measTypes.includes(w.type)),
  );
  const measurementReady =
    (hasMeas && !measUnfinished && (measurementReportsCompleted || measurementWorkOrdersCompleted)) ||
    (!hasMeas && hasProd);
  /** Merenje završeno (RN + izveštaj) — od ovoga zavisi gate za revidirane ponude i materijal. */
  const measurementCompleteWithMeas =
    hasMeas && !measUnfinished && (measurementReportsCompleted || measurementWorkOrdersCompleted);
  const legacyNoMeasurementButProduction = !hasMeas && hasProd;

  const measurementFinishedTimestamps: number[] = [];
  for (const r of reports) {
    if (r.completed !== true) continue;
    const woId = r.work_order_id;
    if (!woId || !wos.some((w) => w.id === woId && measTypes.includes(w.type))) continue;
    const finishedRaw = r.details?.finishedAt ?? null;
    if (finishedRaw) {
      const t = Date.parse(finishedRaw);
      if (Number.isFinite(t) && t > 0) measurementFinishedTimestamps.push(t);
    }
    const createdRaw = r.created_at ?? null;
    if (createdRaw) {
      const t = Date.parse(createdRaw);
      if (Number.isFinite(t) && t > 0) measurementFinishedTimestamps.push(t);
    }
  }
  const measurementFinishedAt =
    measurementFinishedTimestamps.length > 0 ? Math.max(...measurementFinishedTimestamps) : 0;

  const measPhaseOpen = hasMeas && !measurementReady;

  /**
   * Hard stop protiv "preskakanja faza":
   * iz aktivnog merenja se uvek ide prvo u "Obrada mera",
   * pa tek zatim kroz ostale post-measurement korake.
   */
  if (current === "measuring" && measurementCompleteWithMeas) {
    return {
      status: "measurement_processing",
      reason: "Measurement completed; enforce processing step before downstream statuses",
    };
  }

  const prodUnfinished = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const prodDone =
    hasProd &&
    !prodUnfinished &&
    wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && w.status === "completed");
  const hasInst = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE);
  const instUnfinished = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const instJobDone =
    hasInst &&
    !instUnfinished &&
    wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed");
  const instInProgress = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "in_progress");

  if (instJobDone) {
    const completedInst = wos.filter(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed" && w.id,
    );
    const badReport = completedInst.some((w) =>
      reports.some((r) => r.work_order_id === w.id && r.everything_ok === false),
    );
    if (badReport) return { status: "complaint", reason: "Installation report contains issues" };
    const completedInstallReport = reports.some(
      (r) => completedInst.some((w) => w.id === r.work_order_id) && r.completed === true,
    );
    if (completedInstallReport) {
      if (unpaidBalance > 0.009) {
        return { status: "installation_in_progress", reason: "Installation completed, waiting full payment before completion" };
      }
      return { status: "completed", reason: "Installation completed with final field report and fully paid job" };
    }
  }

  const installationArrived = reports.some(
    (r) =>
      r.details?.arrivedAt &&
      wos.some((w) => w.id === r.work_order_id && w.type === INSTALLATION_WORK_ORDER_TYPE),
  );
  if (instInProgress || installationArrived) {
    return { status: "installation_in_progress", reason: "Installation started or team arrival recorded" };
  }

  const waitingInstall = prodDone && hasInst && wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "pending");
  if (waitingInstall) return { status: "scheduled", reason: "Production completed and installation work order created" };

  const hasMaterialOrder = materialOrders.length > 0;
  const allMaterialsDelivered =
    hasMaterialOrder && materialOrders.every((o) => o.delivery_status === "delivered");

  /**
   * Posle završenog merenja: prvo obrada mera → ponuda → prihvaćeno, tek onda materijal/proizvodnja.
   * Starije narudžbine materijala ne smeju da preskoče `measurement_processing` / `quote_sent` / `ready_for_work`.
   */
  if (measurementCompleteWithMeas) {
    const postMeasurementQuotes = quotes.filter((q) => {
      const createdAt = q.created_at ? Date.parse(q.created_at) : 0;
      if (measurementFinishedAt <= 0) {
        return (q.version_number ?? 1) > 1;
      }
      return Number.isFinite(createdAt) && createdAt >= measurementFinishedAt;
    });
    const hasPostMeasurementAccepted = postMeasurementQuotes.some((q) => q.status === "accepted");

    if (!hasPostMeasurementAccepted) {
      return {
        status: "measurement_processing",
        reason: "Post-measurement quote is pending acceptance; keep processing stage",
      };
    }

    if (hasMaterialOrder && allMaterialsDelivered && !instInProgress && !instJobDone) {
      return { status: "in_production", reason: "All material orders delivered" };
    }
    if (hasMaterialOrder && !allMaterialsDelivered) {
      return { status: "waiting_material", reason: "Material order sent and awaiting delivery" };
    }
    return { status: "ready_for_work", reason: "Post-measurement quote accepted" };
  }

  if (legacyNoMeasurementButProduction) {
    if (hasMaterialOrder && allMaterialsDelivered && !instInProgress && !instJobDone) {
      return { status: "in_production", reason: "All material orders delivered" };
    }
    if (hasMaterialOrder && !allMaterialsDelivered) {
      return { status: "waiting_material", reason: "Material order sent and awaiting delivery" };
    }
    return { status: "in_production", reason: "Production phase without measurement work orders" };
  }

  if (measPhaseOpen) return { status: "measuring", reason: "Measurement work order assigned or created" };

  const hasAcceptedQuote = quotes.some((q) => q.status === "accepted");
  if (hasAcceptedQuote || context.hasAdvancePayment) {
    return { status: "accepted", reason: hasAcceptedQuote ? "Quote accepted" : "Advance payment recorded" };
  }
  if (quotes.some((q) => q.status === "sent")) return { status: "quote_sent", reason: "Quote sent to customer" };
  return { status: "new", reason: "No workflow trigger matched (inquiry stage)" };
}

/** Alias za event-driven poziv iz hook-ova/modula. */
export async function updateJobStatusFromEvent(jobId: string, authorId?: string | null): Promise<void> {
  await recomputeJobStatus(jobId, authorId ?? null);
}

/** Alias za sinhronizaciju posle promene entiteta (ponuda/RN/materijal/izveštaj/uplata). */
export async function syncJobStatusAfterEntityChange(jobId: string, authorId?: string | null): Promise<void> {
  await recomputeJobStatus(jobId, authorId ?? null);
}

export async function recomputeJobStatus(jobId: string, authorId?: string | null): Promise<void> {
  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("id,status,status_locked,total_price")
    .eq("id", jobId)
    .single();
  if (jobError) throw jobError;
  if (jobRow.status_locked === true) return;
  let currentStatus = jobRow.status as JobStatus;

  const { error: rpcError } = await supabase.rpc("recompute_job_status", {
    p_job_id: jobId,
  });
  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const { data: currentAfterRpc, error: currentAfterRpcError } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  if (!currentAfterRpcError && currentAfterRpc?.status) {
    currentStatus = currentAfterRpc.status as JobStatus;
  }

  const workOrdersRes = await supabase.from("work_orders").select("id, status, type").eq("job_id", jobId);
  if (workOrdersRes.error && !isMissingTableError(workOrdersRes.error.code)) {
    throw workOrdersRes.error;
  }
  const workOrderRows: WorkOrderRow[] = (workOrdersRes.data ?? []).map((row) => ({
    id: row.id as string,
    status: row.status as WorkOrderStatus,
    type: row.type as WorkOrderType,
  }));

  const reportsRes = await supabase
    .from("field_reports")
    .select("work_order_id, everything_ok, site_canceled, completed, details, created_at")
    .eq("job_id", jobId);
  if (reportsRes.error && !isMissingTableError(reportsRes.error.code)) {
    throw reportsRes.error;
  }

  const quotesRes = await supabase
    .from("quotes")
    .select("status,created_at,updated_at,version_number")
    .eq("job_id", jobId);
  if (quotesRes.error && !isMissingTableError(quotesRes.error.code)) {
    throw quotesRes.error;
  }

  const materialOrdersRes = await supabase.from("material_orders").select("delivery_status").eq("job_id", jobId);
  if (materialOrdersRes.error && !isMissingTableError(materialOrdersRes.error.code)) {
    throw materialOrdersRes.error;
  }

  const paymentsRes = await supabase.from("payments").select("amount").eq("job_id", jobId);
  if (paymentsRes.error && !isMissingTableError(paymentsRes.error.code)) {
    throw paymentsRes.error;
  }
  const payments = paymentsRes.data ?? [];
  const hasAdvancePayment = payments.some((row) => Number(row.amount) > 0);
  const totalPaid = payments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const derived = deriveJobStatus(currentStatus, {
    workOrders: workOrderRows,
    quotes: (quotesRes.data ?? []).map((q) => ({
      status: q.status as QuoteStatus,
      created_at: (q as { created_at?: string | null }).created_at ?? null,
      updated_at: (q as { updated_at?: string | null }).updated_at ?? null,
      version_number: (q as { version_number?: number | null }).version_number ?? null,
    })),
    materialOrders: (materialOrdersRes.data ?? []).map((o) => ({
      delivery_status: o.delivery_status as MaterialOrderDeliveryStatus,
    })),
    fieldReports: (reportsRes.data ?? []).map((r) => ({
      work_order_id: (r.work_order_id as string | null) ?? null,
      everything_ok: (r.everything_ok as boolean | null) ?? null,
      site_canceled: (r.site_canceled as boolean | null) ?? null,
      completed: (r.completed as boolean | null) ?? null,
      created_at: (r as { created_at?: string | null }).created_at ?? null,
      details:
        r.details && typeof r.details === "object" && !Array.isArray(r.details)
          ? (r.details as FieldReportRow["details"])
          : null,
    })),
    hasAdvancePayment,
    totalPrice: Number((jobRow as { total_price?: number | string | null }).total_price) || 0,
    totalPaid,
  });
  if (derived.status === currentStatus) return;

  const { data: updatedRows, error: updateError } = await supabase
    .from("jobs")
    .update({ status: derived.status })
    .eq("id", jobId)
    .select("id,status");
  if (updateError) throw updateError;
  if (!updatedRows?.length) {
    console.warn(
      "Auto job status: UPDATE jobs returned 0 rows (likely RLS). Deploy migration 20260418100000_rpc_recompute_job_status.sql.",
    );
    return;
  }

  await upsertSystemActivity({
    jobId,
    description: `Status automatski promenjen: ${labelJobStatus(currentStatus)} -> ${labelJobStatus(derived.status)} (${derived.reason})`,
    systemKey: `auto-job-status:${jobId}:${currentStatus}:${derived.status}`,
    authorId: authorId ?? null,
  });
}
