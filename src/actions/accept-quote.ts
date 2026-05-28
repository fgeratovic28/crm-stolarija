import { supabase } from "@/lib/supabase";
import type { JobStatus, QuoteStatus } from "@/types";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { applyJobPriceFromAcceptedQuote } from "@/lib/sync-job-from-quote";
import { normalizeVatRatePercent } from "@/lib/job-pricing";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { quoteAcceptanceRequiresConfirmedPrice } from "@/lib/quote-acceptance-pricing";

export type AcceptQuoteInput = {
  quoteId: string;
  jobId: string;
  /** Obavezno za finalnu / dopunsku ponudu; početna ponuda se prihvata bez iznosa. */
  totalPrice?: number;
  /** Stopa PDV (0 ili 20); ako nedostaje, koristi kolona ponude `vat_rate_percent`. */
  vatRatePercent?: number;
  /** Načun PDV u stavkama; ako nedostaje, koristi ponuda/prices_include_vat. */
  pricesIncludeVat?: boolean;
  authorId?: string | null;
};

export async function acceptQuote(input: AcceptQuoteInput): Promise<void> {
  const { data: row, error: rowErr } = await supabase
    .from("quotes")
    .select(
      "id, job_id, quote_number, status, prices_include_vat, vat_rate_percent, is_addon_work, is_final, version_number, note",
    )
    .eq("id", input.quoteId)
    .single();

  if (rowErr || !row) {
    throw new Error(rowErr?.message ?? "Ponuda nije pronađena.");
  }
  const jobIdRow = typeof (row as { job_id?: string }).job_id === "string" ? (row as { job_id: string }).job_id : "";
  if (jobIdRow !== input.jobId) {
    throw new Error("Ponuda ne pripada ovom poslu.");
  }

  const isAddonWork = Boolean((row as { is_addon_work?: boolean | null }).is_addon_work);
  const versionNumber = Number((row as { version_number?: number | null }).version_number) || 1;
  const isFinalOffer =
    (row as { is_final?: boolean | null }).is_final === true ||
    (typeof (row as { note?: string | null }).note === "string" &&
      (row as { note: string }).note.trim().toLowerCase().startsWith("[final]"));

  const { data: jobSnap, error: jobSnapErr } = await supabase
    .from("jobs")
    .select("status, parent_job_id")
    .eq("id", input.jobId)
    .single();
  if (jobSnapErr) {
    throw new Error(jobSnapErr.message ?? "Posao nije pronađen.");
  }
  const jobStatusBefore = (jobSnap as { status?: string }).status as JobStatus | undefined;
  const parentJobId = (jobSnap as { parent_job_id?: string | null }).parent_job_id;
  const isChildJob = typeof parentJobId === "string" && parentJobId.length > 0;

  const requiresConfirmedPrice = quoteAcceptanceRequiresConfirmedPrice(
    jobStatusBefore,
    { isAddonWork, isFinalOffer, versionNumber },
    { isChildJob },
  );

  const tp = Number(input.totalPrice);
  if (requiresConfirmedPrice) {
    if (!Number.isFinite(tp) || tp <= 0) {
      throw new Error("Unesite ispravan konačan iznos.");
    }
  }

  const currentStatus = (row as { status?: string }).status;
  if (currentStatus === "accepted") {
    throw new Error("Ponuda je već označena kao prihvaćena.");
  }
  if (currentStatus === "zamenjena") {
    throw new Error("Ova ponuda je arhivirana (starija verzija).");
  }

  if (!isAddonWork) {
    const { error: archErr } = await supabase
      .from("quotes")
      .update({ status: "zamenjena" as QuoteStatus })
      .eq("job_id", input.jobId)
      .neq("id", input.quoteId)
      .eq("status", "accepted");
    if (archErr) {
      throw archErr;
    }
  }

  const quoteVat =
    typeof input.vatRatePercent === "number"
      ? normalizeVatRatePercent(input.vatRatePercent)
      : normalizeVatRatePercent((row as { vat_rate_percent?: number | null }).vat_rate_percent);

  const pricesIncludeVat =
    typeof input.pricesIncludeVat === "boolean"
      ? input.pricesIncludeVat
      : (row as { prices_include_vat?: boolean | null }).prices_include_vat !== false;

  if (requiresConfirmedPrice) {
    const { error: totErr } = await supabase
      .from("quotes")
      .update({
        total_amount: tp,
        vat_rate_percent: quoteVat,
        prices_include_vat: pricesIncludeVat,
      })
      .eq("id", input.quoteId);
    if (totErr) {
      throw totErr;
    }

    if (!isAddonWork) {
      const syncResult = await applyJobPriceFromAcceptedQuote({
        jobId: input.jobId,
        totalAmount: tp,
        pricesIncludeVat,
        vatRatePercent: quoteVat,
      });
      if (!syncResult.ok) {
        throw new Error(syncResult.error);
      }
    }
  }

  const { error: stErr } = await supabase
    .from("quotes")
    .update({ status: "accepted" as const })
    .eq("id", input.quoteId);
  if (stErr) {
    throw stErr;
  }

  if (!isAddonWork) {
    const nextJobStatus: JobStatus = isChildJob
      ? "final_quote_accepted_pending_payment"
      : isFinalOffer ||
          jobStatusBefore === "final_quote_sent" ||
          jobStatusBefore === "final_quote_accepted_pending_payment"
        ? "final_quote_accepted_pending_payment"
        : "accepted";
    const { error: jobStatusErr } = await supabase
      .from("jobs")
      .update({ status: nextJobStatus })
      .eq("id", input.jobId);
    if (jobStatusErr) {
      throw jobStatusErr;
    }
  }

  if (isAddonWork) {
    const { error: woRpcErr } = await supabase.rpc("create_addon_installation_work_order_after_quote", {
      p_quote_id: input.quoteId,
    });
    if (woRpcErr) {
      throw new Error(woRpcErr.message || "Kreiranje naloga ugradnje za dopunu nije uspelo.");
    }
  }

  const quoteNumber = typeof (row as { quote_number?: string }).quote_number === "string"
    ? (row as { quote_number: string }).quote_number
    : input.quoteId;

  const activityDescription = isAddonWork
    ? `Dopunska ponuda prihvaćena: ${quoteNumber} — iznos ${tp} (status posla ne menja se automatski).`
    : requiresConfirmedPrice
      ? `Ponuda prihvaćena: ${quoteNumber} — potvrđen iznos ${tp}`
      : `Ponuda prihvaćena: ${quoteNumber} (početna ponuda; iznos se unosi pri finalnoj ponudi).`;

  await upsertSystemActivity({
    jobId: input.jobId,
    description: activityDescription,
    systemKey: `quote-accepted:${input.quoteId}`,
    authorId: input.authorId ?? null,
  });

  if (!isAddonWork) {
    const { error: clearKeepErr } = await supabase
      .from("jobs")
      .update({ post_measurement_keep_initial_quote: false })
      .eq("id", input.jobId);
    if (clearKeepErr) {
      console.warn("post_measurement_keep_initial_quote clear:", clearKeepErr.message);
    }
  }

  try {
    await recomputeJobStatus(input.jobId, input.authorId ?? null);
  } catch (err) {
    console.warn("Auto status recompute failed after quote acceptance:", err);
  }
}
