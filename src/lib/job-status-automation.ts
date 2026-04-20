import { supabase } from "@/lib/supabase";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";
import type { JobStatus, WorkOrderType } from "@/types";
import {
  INSTALLATION_WORK_ORDER_TYPE,
  MEASUREMENT_WORK_ORDER_TYPES,
  PRODUCTION_WORK_ORDER_TYPE,
} from "@/lib/job-status-lifecycle";

type WorkOrderStatus = "pending" | "in_progress" | "completed" | "canceled";

type WorkOrderRow = { id?: string; status: WorkOrderStatus; type: WorkOrderType };

/** Statusi koje automatska pravila ne menjaju dok su aktivni (ručni režimi). */
const PRESERVED_MANUAL_AUTOMATION_STATUSES = new Set<JobStatus>(["quote_sent", "service"]);

/** Reklamacija: automatski ulaz moguć; izlaz i dalje ručno (ne prepisujemo iz automatske petlje). */
function automationSkipsRecompute(current: JobStatus): boolean {
  return PRESERVED_MANUAL_AUTOMATION_STATUSES.has(current) || current === "complaint";
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

/**
 * Ista pravila kao RPC `recompute_job_status` (fallback kad RPC nije dostupan).
 * `installationReportBadByWoId` — work_order_id → true ako postoji izveštaj sa everything_ok = false.
 */
export function computeNextJobStatus(
  current: JobStatus,
  workOrders: WorkOrderRow[],
  installationReportBadByWoId: ReadonlyMap<string, boolean>,
): JobStatus {
  if (automationSkipsRecompute(current)) return current;

  const wos = workOrders;
  const measTypes = MEASUREMENT_WORK_ORDER_TYPES as readonly WorkOrderType[];
  const hasMeas = wos.some((w) => measTypes.includes(w.type));
  const measUnfinished = wos.some((w) => measTypes.includes(w.type) && !terminalWo(w.status));
  const hasProd = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE);
  const measPhaseDone = (hasMeas && !measUnfinished) || (!hasMeas && hasProd);

  const measInProgress = wos.some((w) => measTypes.includes(w.type) && w.status === "in_progress");
  /** Merenje: i pending RN merenja (posle kreiranja), ne samo in_progress. */
  const measPhaseOpen = hasMeas && !measPhaseDone;

  const prodUnfinished = wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const prodDone =
    hasProd &&
    !prodUnfinished &&
    wos.some((w) => w.type === PRODUCTION_WORK_ORDER_TYPE && w.status === "completed");
  const prodDoneEffective = !hasProd || prodDone;

  const hasInst = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE);
  const instUnfinished = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && !terminalWo(w.status));
  const instJobDone =
    hasInst &&
    !instUnfinished &&
    wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed");
  const instInProgress = wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "in_progress");

  const installAllPending =
    hasInst && !wos.some((w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status !== "pending");

  const scheduled =
    measPhaseDone &&
    prodDoneEffective &&
    ((hasInst && installAllPending) || (!hasInst && hasProd && prodDone));

  const inProduction =
    measPhaseDone && !measInProgress && !scheduled && !instInProgress && !instJobDone;

  if (instJobDone) {
    const completedInst = wos.filter(
      (w) => w.type === INSTALLATION_WORK_ORDER_TYPE && w.status === "completed" && w.id,
    );
    const badReport = completedInst.some((w) => installationReportBadByWoId.get(w.id!) === true);
    return badReport ? "complaint" : "completed";
  }
  if (instInProgress) return "installation_in_progress";
  if (measPhaseOpen) return "measuring";
  if (scheduled) return "scheduled";
  if (inProduction) return "in_production";
  return "new";
}

type RpcRecomputeRow = {
  did_update: boolean;
  previous_status: JobStatus;
  next_status: JobStatus;
};

export async function recomputeJobStatus(jobId: string, authorId?: string | null): Promise<void> {
  const { data: rpcData, error: rpcError } = await supabase.rpc("recompute_job_status", {
    p_job_id: jobId,
  });

  if (!rpcError && rpcData !== null && rpcData !== undefined) {
    const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as RpcRecomputeRow | undefined;
    if (row && typeof row.did_update === "boolean") {
      if (row.did_update && row.previous_status && row.next_status) {
        await upsertSystemActivity({
          jobId,
          description: `Status automatski promenjen: ${labelJobStatus(row.previous_status)} -> ${labelJobStatus(row.next_status)}`,
          systemKey: `auto-job-status:${jobId}:${row.next_status}`,
          authorId: authorId ?? null,
        });
      }
      return;
    }
  }

  if (rpcError && !isMissingRpcError(rpcError)) throw rpcError;

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("id,status,status_locked")
    .eq("id", jobId)
    .single();
  if (jobError) throw jobError;
  if (jobRow.status_locked === true) return;
  const currentStatus = jobRow.status as JobStatus;

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
    .select("work_order_id, everything_ok")
    .eq("job_id", jobId);
  if (reportsRes.error && !isMissingTableError(reportsRes.error.code)) {
    throw reportsRes.error;
  }

  const badByWo = new Map<string, boolean>();
  for (const r of reportsRes.data ?? []) {
    const woId = r.work_order_id as string | null;
    if (!woId) continue;
    if (r.everything_ok === false) badByWo.set(woId, true);
  }

  const nextStatus = computeNextJobStatus(currentStatus, workOrderRows, badByWo);
  if (nextStatus === currentStatus) return;

  const { data: updatedRows, error: updateError } = await supabase
    .from("jobs")
    .update({ status: nextStatus })
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
    description: `Status automatski promenjen: ${labelJobStatus(currentStatus)} -> ${labelJobStatus(nextStatus)}`,
    systemKey: `auto-job-status:${jobId}:${nextStatus}`,
    authorId: authorId ?? null,
  });
}
