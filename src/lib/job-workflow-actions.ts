import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { fieldReportFlowForWorkOrderType } from "@/lib/field-team-access";
import {
  applyFieldReportSiteVisitSuccess,
  applyFieldReportWorkflowBranching,
  ensureWorkflowWorkOrders,
} from "@/lib/work-order-workflow-automation";
import type { FieldReport, JobStatus, WorkOrderType } from "@/types";

/**
 * Klijent za Vite/Electron. Za Next.js App Router, iste funkcije pozovite iz `"use server"`
 * fajlova (createServerClient + ove async funkcije).
 */
export type FieldWorkerReportInput = Omit<FieldReport, "id"> & {
  workOrderId?: string;
  workOrderType?: WorkOrderType;
};

/**
 * 1) Terenski / montažni / proizvodni izveštaj: insert field_reports, zatvara RN, grananje, recompute, ensure,
 *    i ako je uspešan site_visit (teren) posle rekl/servis ili instalacionog problema — RPC za povratak u Završen.
 */
export async function submitFieldWorkerFieldReport(
  client: SupabaseClient,
  report: FieldWorkerReportInput,
  userId: string | null,
): Promise<{ id: string }> {
  const detailsJson = report.details && Object.keys(report.details).length > 0 ? report.details : {};
  const issueTrim = report.issueDescription?.trim() || "";
  const missingArr = Array.isArray(report.missingItems) ? report.missingItems : [];
  const isAddonQuote = !!report.addonQuoteSiteRequest;

  const hasPredracunMissing =
    report.details &&
    typeof report.details === "object" &&
    "invoiceMissingDeferAutoInstallationWo" in report.details &&
    report.details.invoiceMissingDeferAutoInstallationWo === true;

  const hasProblemContent = !isAddonQuote && (
    issueTrim.length > 0 ||
    (missingArr.length > 0 && hasPredracunMissing)
  );
  const notOk = !isAddonQuote && (report.everythingOk === false || hasProblemContent);
  const everythingOkValue = !notOk;
  const issuesValue = isAddonQuote
    ? null
    : issueTrim ||
      (missingArr.length > 0 ? `Nedostaje / nije isporučeno: ${missingArr.join(", ")}` : null);

  const missingInsert = isAddonQuote ? [] : notOk ? missingArr : [];

  const reportData = {
    work_order_id: report.workOrderId || null,
    job_id: report.jobId || null,
    address: report.address?.trim() || null,
    arrived: report.arrived,
    arrival_datetime: report.arrivalDate ?? null,
    site_canceled: report.siteCanceled,
    cancel_reason: report.cancelReason?.trim() || null,
    completed: report.jobCompleted,
    /* I issues i missing uvek guraju u "nije u redu" ako postoji sadržaj. */
    everything_ok: everythingOkValue,
    issues: issuesValue,
    images: report.images,
    missing_items: missingInsert,
    additional_needs: report.additionalNeeds,
    measurements: report.measurements?.trim() || null,
    general_report: report.generalNotes,
    details: detailsJson,
    estimated_installation_hours:
      report.estimatedInstallationHours != null && Number.isFinite(report.estimatedInstallationHours)
        ? report.estimatedInstallationHours
        : null,
    addon_quote_site_request: !!report.addonQuoteSiteRequest,
  };

  const { data, error } = await client.from("field_reports").insert([reportData]).select().single();

  if (error) throw error;
  const reportId = data.id as string;

  if (report.jobId && report.workOrderId) {
    const row = data as { job_id?: string | null };
    if (row.job_id == null) {
      const { error: fixJobErr } = await client
        .from("field_reports")
        .update({ job_id: report.jobId })
        .eq("id", reportId);
      if (fixJobErr) {
        console.warn("field_reports.job_id nije popunjen posle unosa (RLS/edge):", fixJobErr.message);
      }
    }
  }

  if (report.workOrderId) {
    const nextStatus: "completed" | "canceled" = report.siteCanceled ? "canceled" : "completed";
    const completedAtIso = new Date().toISOString();
    const woPatch: { status: typeof nextStatus; field_completed_at?: string | null } = {
      status: nextStatus,
      ...(nextStatus === "completed" ? { field_completed_at: completedAtIso } : {}),
    };
    const { error: statusError } = await client.from("work_orders").update(woPatch).eq("id", report.workOrderId);
    if (statusError) throw statusError;
  }

  if (report.jobId) {
    const reportFlow = fieldReportFlowForWorkOrderType(report.workOrderType);
    await upsertSystemActivity({
      jobId: report.jobId,
      description:
        reportFlow === "production"
          ? "Dodat izveštaj proizvodnje"
          : reportFlow === "mounting"
            ? "Dodat montažni izveštaj"
            : "Dodat terenski izveštaj",
      systemKey: `field-report-created:${reportId}`,
      authorId: userId ?? null,
    });
    try {
      await applyFieldReportWorkflowBranching(reportId, client);
    } catch (err) {
      console.warn("applyFieldReportWorkflowBranching posle terenskog izveštaja:", err);
    }
    try {
      await recomputeJobStatus(report.jobId, userId ?? null, client);
    } catch (err) {
      console.warn("Auto status recompute failed after field report:", err);
    }
    try {
      await ensureWorkflowWorkOrders(report.jobId, client);
    } catch (err) {
      console.warn("ensureWorkflowWorkOrders posle terenskog izveštaja:", err);
    }

    const wot = report.workOrderType;
    if (
      (wot === "site_visit" || wot === "complaint" || wot === "service") &&
      everythingOkValue &&
      !report.siteCanceled
    ) {
      try {
        await applyFieldReportSiteVisitSuccess(reportId);
      } catch (err) {
        console.warn("apply_field_report_site_visit_success:", err);
      }
    }
  }

  return { id: reportId };
}

const WARRANTY_VISIT_DESCRIPTION_BASE = "Teren — obilazak lokacije (bez ugradnje).";

/**
 * 3) Kancelarija: sa Završenog posla poseban RN reklamacija ili servis (teren obilazak), bez punjenja opisa poslom/ponudom.
 */
export async function openWarrantyOrServiceFromCompletedJob(
  client: SupabaseClient,
  input: {
    jobId: string;
    kind: "complaint" | "service";
    /** Planirani datum obilaska (YYYY-MM-DD) — `work_orders.date`. */
    scheduledVisitDate: string;
    /** Kratka napomena; opciono. */
    notes: string;
    actorUserId: string | null;
    /** Opcioni prilog uz novi RN (`work_orders.file_id`). */
    attachmentFileId?: string | null;
  },
): Promise<void> {
  const dateStr = (input.scheduledVisitDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error("Unesite validan planirani datum obilaska.");
  }
  const notes = (input.notes || "").trim();
  const description = notes
    ? `${WARRANTY_VISIT_DESCRIPTION_BASE}\n\n${notes}`
    : WARRANTY_VISIT_DESCRIPTION_BASE;

  const { data: job, error: jErr } = await client
    .from("jobs")
    .select("id, status")
    .eq("id", input.jobId)
    .single();
  if (jErr) throw jErr;
  if (!job || (job.status as string) !== "completed") {
    throw new Error("Reklamacija/servis se može otvoriti samo sa statusa posla „Završen”.");
  }

  const nextStatus: JobStatus = input.kind;
  const workOrderType = input.kind;

  const { error: wErr } = await client.from("work_orders").insert({
    job_id: input.jobId,
    type: workOrderType,
    description: description,
    date: dateStr,
    status: "pending" as const,
    team_id: null,
    ...(input.attachmentFileId ? { file_id: input.attachmentFileId } : {}),
  });
  if (wErr) throw wErr;

  const { error: uErr } = await client
    .from("jobs")
    .update({
      status: nextStatus,
      status_changed_at: new Date().toISOString(),
    })
    .eq("id", input.jobId);
  if (uErr) throw uErr;

  await upsertSystemActivity({
    jobId: input.jobId,
    description:
      input.kind === "complaint"
        ? "Otvorena reklamacija; kreiran radni nalog tipa reklamacija (planirani teren, na čekanju)."
        : "Otvoren servis; kreiran radni nalog tipa servis (planirani teren, na čekanju).",
    systemKey: `warranty-or-service-wo:${input.jobId}:${Date.now()}`,
    authorId: input.actorUserId,
  });
}

/**
 * 4) Eksplicitan alias: uspeh terenskog (site_visit) — logika u `apply_field_report_site_visit_success` (baza).
 */
export async function completeFollowUpFromSiteVisitFieldReport(
  client: SupabaseClient,
  fieldReportId: string,
): Promise<void> {
  await applyFieldReportSiteVisitSuccess(fieldReportId, client);
}
