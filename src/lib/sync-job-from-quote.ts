import { supabase } from "@/lib/supabase";
import {
  computeJobAmountsFromLineSum,
  normalizeVatRatePercent,
  vatAmountsFromTotalDue,
} from "@/lib/job-pricing";

export type ReplaceJobFromQuoteResult = { ok: true } | { ok: false; error: string };

const quotePriceSyncPayload = (params: {
  totalAmount: number;
  pricesIncludeVat: boolean;
  vatRatePercent: number;
}) => ({
  total_amount: params.totalAmount,
  vat_rate_percent: normalizeVatRatePercent(params.vatRatePercent),
  prices_include_vat: params.pricesIncludeVat,
});

/**
 * Pri prihvatanju ponude: `jobs.total_price` / PDV iz `quotes.total_amount` (PDF ponude, bez stavki reda).
 */
export async function applyJobPriceFromAcceptedQuote(params: {
  jobId: string;
  totalAmount: number;
  pricesIncludeVat: boolean;
  vatRatePercent: number;
}): Promise<ReplaceJobFromQuoteResult> {
  const total = Number(params.totalAmount);
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, error: "Prihvaćena ponuda nema validan ukupan iznos za upis na posao." };
  }

  const rate = Number(params.vatRatePercent) === 20 ? 20 : 0;
  const { totalPrice, vatAmount } = params.pricesIncludeVat
    ? vatAmountsFromTotalDue(total, rate)
    : computeJobAmountsFromLineSum(total, false, rate);

  const { data: jobUpdated, error: jobError } = await supabase
    .from("jobs")
    .update({
      total_price: totalPrice,
      vat_amount: vatAmount,
      prices_include_vat: params.pricesIncludeVat,
      vat_rate_percent: rate,
    })
    .eq("id", params.jobId)
    .select("id, total_price")
    .maybeSingle();

  if (jobError) {
    return { ok: false, error: jobError.message || "Ažuriranje cene posla nije uspelo." };
  }
  if (!jobUpdated?.id) {
    return {
      ok: false,
      error: "Cena posla nije ažurirana (proverite ID posla i dozvole).",
    };
  }
  return { ok: true };
}

/**
 * Pri ručnoj izmeni cene posla: usklađuje `quotes.total_amount` (i PDV polja) sa iznosom za naplatu.
 * Prihvata se uvek; poslate verzije samo ako već imaju unet iznos (početna bez iznosa ostaje 0).
 */
export async function applyQuotePricesFromJob(params: {
  jobId: string;
  totalAmount: number;
  pricesIncludeVat: boolean;
  vatRatePercent: number;
}): Promise<ReplaceJobFromQuoteResult> {
  const total = Number(params.totalAmount);
  if (!Number.isFinite(total) || total < 0) {
    return { ok: false, error: "Iznos za usklađivanje ponuda nije validan." };
  }

  const payload = quotePriceSyncPayload(params);

  const { error: acceptedErr } = await supabase
    .from("quotes")
    .update(payload)
    .eq("job_id", params.jobId)
    .eq("status", "accepted");

  if (acceptedErr) {
    return { ok: false, error: acceptedErr.message || "Ažuriranje prihvaćene ponude nije uspelo." };
  }

  const { error: sentErr } = await supabase
    .from("quotes")
    .update(payload)
    .eq("job_id", params.jobId)
    .eq("status", "sent")
    .gt("total_amount", 0);

  if (sentErr) {
    return { ok: false, error: sentErr.message || "Ažuriranje poslate ponude nije uspelo." };
  }

  return { ok: true };
}
