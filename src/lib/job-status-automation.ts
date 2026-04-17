import { supabase } from "@/lib/supabase";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { labelJobStatus } from "@/lib/activity-labels";
import type { JobStatus } from "@/types";

type WorkOrderStatus = "pending" | "in_progress" | "completed" | "canceled";
type DeliveryStatus = "pending" | "shipped" | "delivered" | "partial";

const PRESERVED_MANUAL_STATUSES = new Set<JobStatus>(["complaint", "service"]);

function isMissingTableError(code?: string) {
  return code === "42P01" || code === "PGRST205";
}

function computeAutoStatus(
  current: JobStatus,
  workOrderStatuses: WorkOrderStatus[],
  deliveryStatuses: DeliveryStatus[],
): JobStatus {
  if (PRESERVED_MANUAL_STATUSES.has(current)) return current;

  const hasWorkOrders = workOrderStatuses.length > 0;
  const hasMaterials = deliveryStatuses.length > 0;
  const hasInProgressWork = workOrderStatuses.includes("in_progress");
  const hasPendingWork = workOrderStatuses.includes("pending");
  const hasBlockingMaterials = deliveryStatuses.some((s) => s !== "delivered");
  const allWorkCompleted = hasWorkOrders && workOrderStatuses.every((s) => s === "completed");

  if (allWorkCompleted) return "completed";
  if (hasInProgressWork) return "in_progress";
  if (hasPendingWork && hasBlockingMaterials) return "waiting_materials";
  if (hasPendingWork) return "active";
  if (hasMaterials && hasBlockingMaterials) return "waiting_materials";
  if (hasMaterials) return "active";
  return current;
}

export async function recomputeJobStatus(jobId: string, authorId?: string | null): Promise<void> {
  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("id,status,status_locked")
    .eq("id", jobId)
    .single();
  if (jobError) throw jobError;
  if (jobRow.status_locked === true) return;
  const currentStatus = jobRow.status as JobStatus;

  const workOrdersRes = await supabase
    .from("work_orders")
    .select("status")
    .eq("job_id", jobId);
  if (workOrdersRes.error && !isMissingTableError(workOrdersRes.error.code)) {
    throw workOrdersRes.error;
  }
  const workOrderStatuses = (workOrdersRes.data ?? [])
    .map((row) => row.status as WorkOrderStatus)
    .filter(Boolean);

  const materialsRes = await supabase
    .from("material_orders")
    .select("delivery_status")
    .eq("job_id", jobId);
  if (materialsRes.error && !isMissingTableError(materialsRes.error.code)) {
    throw materialsRes.error;
  }
  const deliveryStatuses = (materialsRes.data ?? [])
    .map((row) => row.delivery_status as DeliveryStatus)
    .filter(Boolean);

  const nextStatus = computeAutoStatus(currentStatus, workOrderStatuses, deliveryStatuses);
  if (nextStatus === currentStatus) return;

  const { error: updateError } = await supabase
    .from("jobs")
    .update({ status: nextStatus })
    .eq("id", jobId);
  if (updateError) throw updateError;

  await upsertSystemActivity({
    jobId,
    description: `Status automatski promenjen: ${labelJobStatus(currentStatus)} -> ${labelJobStatus(nextStatus)}`,
    systemKey: `auto-job-status:${jobId}:${nextStatus}`,
    authorId: authorId ?? null,
  });
}
