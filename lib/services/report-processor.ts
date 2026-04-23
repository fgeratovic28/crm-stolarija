import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkOrderReportPayload = {
  workOrderId: string;
  jobId: string;
  workOrderType: "merenje" | "proizvodnja" | "montaza" | "teren";
  completionStatus: "uspesno" | "delimicno" | "otkazano_na_terenu";
  issuesFound: boolean;
  reportNotes: string;
};

type ProcessResult = {
  workOrderStatus: string;
  jobStatus: string;
  followUpWorkOrderId?: string;
};

function required(value: string, field: string) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }
}

function resolveStatusTransition(payload: WorkOrderReportPayload): {
  workOrderStatus: string;
  jobStatus: string;
  createServiceOrder: boolean;
  needsOfficeLog: boolean;
} {
  // 2) Issues override all other transitions.
  if (payload.issuesFound) {
    return {
      workOrderStatus: "problem",
      jobStatus: "reklamacija",
      createServiceOrder: true,
      needsOfficeLog: false,
    };
  }

  // 3) Canceled on site -> on hold + office note.
  if (payload.completionStatus === "otkazano_na_terenu") {
    return {
      workOrderStatus: "otkazano",
      jobStatus: "zastoj",
      createServiceOrder: false,
      needsOfficeLog: true,
    };
  }

  // 1) Successful completion with no issues.
  if (payload.completionStatus === "uspesno") {
    if (payload.workOrderType === "merenje") {
      return {
        workOrderStatus: "zavrseno",
        jobStatus: "spremno_za_ponudu",
        createServiceOrder: false,
        needsOfficeLog: false,
      };
    }
    if (payload.workOrderType === "proizvodnja") {
      return {
        workOrderStatus: "zavrseno",
        jobStatus: "spremno_za_montazu",
        createServiceOrder: false,
        needsOfficeLog: false,
      };
    }
    if (payload.workOrderType === "montaza") {
      return {
        workOrderStatus: "zavrseno",
        jobStatus: "zavrseno",
        createServiceOrder: false,
        needsOfficeLog: false,
      };
    }
  }

  // Delimicno (or any other valid fallback) without issues -> keep as problem + hold.
  return {
    workOrderStatus: "problem",
    jobStatus: "zastoj",
    createServiceOrder: false,
    needsOfficeLog: true,
  };
}

export async function processWorkOrderReport(
  supabase: SupabaseClient,
  reportData: WorkOrderReportPayload,
  actorUserId?: string,
): Promise<ProcessResult> {
  required(reportData.workOrderId, "workOrderId");
  required(reportData.jobId, "jobId");

  const transition = resolveStatusTransition(reportData);

  const { data: previousOrder, error: previousOrderError } = await supabase
    .from("work_orders")
    .select("id, status")
    .eq("id", reportData.workOrderId)
    .maybeSingle();
  if (previousOrderError) throw previousOrderError;
  if (!previousOrder) throw new Error("Work order not found.");

  const { data: previousJob, error: previousJobError } = await supabase
    .from("jobs")
    .select("id, status")
    .eq("id", reportData.jobId)
    .maybeSingle();
  if (previousJobError) throw previousJobError;
  if (!previousJob) throw new Error("Job not found.");

  let followUpWorkOrderId: string | undefined;

  try {
    const { error: updateOrderError } = await supabase
      .from("work_orders")
      .update({
        status: transition.workOrderStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reportData.workOrderId);
    if (updateOrderError) throw updateOrderError;

    const { error: updateJobError } = await supabase
      .from("jobs")
      .update({
        status: transition.jobStatus,
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", reportData.jobId);
    if (updateJobError) throw updateJobError;

    if (transition.createServiceOrder) {
      const { data: createdOrder, error: createOrderError } = await supabase
        .from("work_orders")
        .insert({
          job_id: reportData.jobId,
          type: "teren",
          status: "pending",
          date: new Date().toISOString().slice(0, 10),
          description: reportData.reportNotes?.trim()
            ? `Auto-kreirano posle izveštaja sa problemom. Detalji: ${reportData.reportNotes.trim()}`
            : "Auto-kreirano posle izveštaja sa problemom.",
          created_by: actorUserId ?? null,
        })
        .select("id")
        .single();
      if (createOrderError) throw createOrderError;
      followUpWorkOrderId = createdOrder.id;
    }

    if (transition.needsOfficeLog) {
      const { error: logError } = await supabase.from("activities").insert({
        job_id: reportData.jobId,
        type: "other",
        description: reportData.reportNotes?.trim()
          ? `Izveštaj: posao je otkazan / u zastoju. Potrebno novo planiranje. Napomena: ${reportData.reportNotes.trim()}`
          : "Izveštaj: posao je otkazan / u zastoju. Potrebno novo planiranje od kancelarije.",
        date: new Date().toISOString(),
        created_by: actorUserId ?? null,
      });
      if (logError) throw logError;
    }

    return {
      workOrderStatus: transition.workOrderStatus,
      jobStatus: transition.jobStatus,
      followUpWorkOrderId,
    };
  } catch (error) {
    // Best-effort rollback when a later step fails.
    await supabase
      .from("work_orders")
      .update({ status: previousOrder.status, updated_at: new Date().toISOString() })
      .eq("id", reportData.workOrderId);
    await supabase
      .from("jobs")
      .update({ status: previousJob.status, status_changed_at: new Date().toISOString() })
      .eq("id", reportData.jobId);
    throw error;
  }
}
