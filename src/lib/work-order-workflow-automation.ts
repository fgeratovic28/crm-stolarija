import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Idempotentno kreira sledeće RN u toku (merenje / proizvodnja / ugradnja) prema pravilima u
 * `public.ensure_workflow_work_orders` (SECURITY DEFINER). Bezbedno pozivati posle promene statusa posla,
 * terenskog izveštaja ili RN.
 */
export async function ensureWorkflowWorkOrders(
  jobId: string | null | undefined,
  client: SupabaseClient = supabase,
): Promise<void> {
  if (!jobId) return;
  const { error } = await client.rpc("ensure_workflow_work_orders", { p_job_id: jobId });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "PGRST202") {
      console.warn("ensure_workflow_work_orders RPC nedostaje (migracija nije primenjena):", error.message);
      return;
    }
    console.warn("ensure_workflow_work_orders:", error.message);
  }
}

/**
 * Grananje iz izveštaja: otkaz (samo aktivnost), problem (reklamacija/servis), dopuna (site_visit).
 * Poziva se posle INSERT-a u `field_reports`, pre `ensure_workflow_work_orders`.
 */
export async function applyFieldReportWorkflowBranching(
  fieldReportId: string | null | undefined,
  client: SupabaseClient = supabase,
): Promise<void> {
  if (!fieldReportId) return;
  const { error } = await client.rpc("apply_field_report_workflow_branching", {
    p_field_report_id: fieldReportId,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "PGRST202") {
      console.warn("apply_field_report_workflow_branching RPC nedostaje (migracija nije primenjena):", error.message);
      return;
    }
    console.warn("apply_field_report_workflow_branching:", error.message);
  }
}

/** Posle uspešnog site_visit (teren) izveštaja: vrati posao u Završen (čuva prvi `first_completed_at` u bazi). */
export async function applyFieldReportSiteVisitSuccess(
  fieldReportId: string | null | undefined,
  client: SupabaseClient = supabase,
): Promise<void> {
  if (!fieldReportId) return;
  const { error } = await client.rpc("apply_field_report_site_visit_success", {
    p_field_report_id: fieldReportId,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42883" || code === "PGRST202") {
      console.warn("apply_field_report_site_visit_success RPC nedostaje (migracija nije primenjena):", error.message);
      return;
    }
    console.warn("apply_field_report_site_visit_success:", error.message);
  }
}
