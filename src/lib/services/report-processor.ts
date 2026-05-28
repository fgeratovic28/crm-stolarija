import type { SupabaseClient } from "@supabase/supabase-js";
import { submitFieldWorkerFieldReport, type FieldWorkerReportInput } from "@/lib/job-workflow-actions";
import type { WorkOrderType } from "@/types";

/**
 * Spoljni API (npr. Next route) — mapira na isti tok kao CRM terenski izveštaj (`field_reports` + RPC).
 * Stvarni tip radnog naloga se uzima iz baze; polje u payloadu služi za proveru/telemetriju.
 */
export type WorkOrderReportPayload = {
  workOrderId: string;
  jobId: string;
  workOrderType: "merenje" | "proizvodnja" | "montaza" | "teren";
  completionStatus: "uspesno" | "delimicno" | "otkazano_na_terenu";
  issuesFound: boolean;
  reportNotes: string;
};

type ProcessResult = {
  workOrderStatus: "pending" | "in_progress" | "completed" | "canceled";
  jobStatus: string;
  fieldReportId: string;
};

function required(value: string, field: string) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }
}

function mapPayloadTypeToLabel(t: WorkOrderReportPayload["workOrderType"]): string {
  switch (t) {
    case "merenje":
      return "merenje";
    case "proizvodnja":
      return "proizvodnja";
    case "montaza":
      return "montaža";
    default:
      return "teren";
  }
}

/**
 * Mapira stari API payload na unos terenskog izveštaja (isti tok kao u aplikaciji).
 */
export async function processWorkOrderReport(
  supabase: SupabaseClient,
  reportData: WorkOrderReportPayload,
  actorUserId?: string,
): Promise<ProcessResult> {
  required(reportData.workOrderId, "workOrderId");
  required(reportData.jobId, "jobId");

  const { data: wo, error: woErr } = await supabase
    .from("work_orders")
    .select("id, job_id, type, jobs ( installation_address )")
    .eq("id", reportData.workOrderId)
    .single();
  if (woErr) throw woErr;
  if (!wo || wo.job_id !== reportData.jobId) {
    throw new Error("Work order not found or job mismatch.");
  }

  const j = wo.jobs as { installation_address?: string | null } | { installation_address?: string | null }[] | null;
  const jobRow = Array.isArray(j) ? j[0] : j;
  const address =
    typeof jobRow?.installation_address === "string" && jobRow.installation_address.trim()
      ? jobRow.installation_address.trim()
      : "—";

  const siteCanceled = reportData.completionStatus === "otkazano_na_terenu";
  const everythingOk = !reportData.issuesFound && !siteCanceled;
  const notes = reportData.reportNotes?.trim() ?? "";
  const typeLabel = mapPayloadTypeToLabel(reportData.workOrderType);
  const generalNotes =
    notes ||
    `[API izveštaj: ${typeLabel}] Nije uneta proširena priča; status=${reportData.completionStatus}, problem=${reportData.issuesFound ? "da" : "ne"}.`;

  const workOrderType = wo.type as WorkOrderType;

  const fr: FieldWorkerReportInput = {
    jobId: reportData.jobId,
    workOrderId: reportData.workOrderId,
    workOrderType,
    address,
    arrived: !siteCanceled,
    siteCanceled,
    jobCompleted: siteCanceled ? false : reportData.completionStatus === "uspesno" || reportData.issuesFound,
    everythingOk,
    issueDescription: reportData.issuesFound ? (notes || "Prijavljen problem (API).") : undefined,
    images: [],
    missingItems: [],
    additionalNeeds: [],
    generalNotes,
    details: {},
  };

  if (workOrderType === "measurement" || workOrderType === "measurement_verification") {
    fr.measurements = notes || "—";
  }

  const { id: fieldReportId } = await submitFieldWorkerFieldReport(supabase, fr, actorUserId ?? null);

  const { data: jobAfter, error: jobAfterErr } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", reportData.jobId)
    .single();
  if (jobAfterErr) throw jobAfterErr;

  return {
    workOrderStatus: siteCanceled ? "canceled" : "completed",
    jobStatus: (jobAfter?.status as string) ?? "",
    fieldReportId,
  };
}
