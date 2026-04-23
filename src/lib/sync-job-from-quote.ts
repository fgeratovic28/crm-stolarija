import { supabase } from "@/lib/supabase";
import { computeJobAmountsFromLineSum, sumQuoteLineAmounts } from "@/lib/job-pricing";

/**
 * Ako posao još nema stavki u `job_quote_lines` (npr. kreiran bez ponude), prva kreirana ponuda
 * prebacuje iste stavke i obračun na posao (kao pri „Novi posao“ sa popunjenom ponudom).
 */
export async function syncJobFromNewQuoteIfEmptyJobLines(params: {
  jobId: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number }>;
  pricesIncludeVat: boolean;
}): Promise<void> {
  const { count, error: countError } = await supabase
    .from("job_quote_lines")
    .select("id", { count: "exact", head: true })
    .eq("job_id", params.jobId);

  if (countError) {
    console.warn("syncJobFromNewQuoteIfEmptyJobLines: count job_quote_lines", countError);
    return;
  }
  if ((count ?? 0) > 0) return;

  const lines = params.lines
    .map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    }))
    .filter((l) => l.description.length > 0 && l.quantity > 0);

  if (lines.length === 0) return;

  const lineSum = sumQuoteLineAmounts(lines);
  if (!Number.isFinite(lineSum) || lineSum <= 0) return;

  const { totalPrice, vatAmount } = computeJobAmountsFromLineSum(lineSum, params.pricesIncludeVat);

  const { error: delError } = await supabase.from("job_quote_lines").delete().eq("job_id", params.jobId);
  if (delError) {
    console.warn("syncJobFromNewQuoteIfEmptyJobLines: delete", delError);
    return;
  }

  const { error: insError } = await supabase.from("job_quote_lines").insert(
    lines.map((l, i) => ({
      job_id: params.jobId,
      sort_order: i,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
    })),
  );
  if (insError) {
    console.warn("syncJobFromNewQuoteIfEmptyJobLines: insert job_quote_lines", insError);
    return;
  }

  const { error: jobError } = await supabase
    .from("jobs")
    .update({
      total_price: totalPrice,
      vat_amount: vatAmount,
      prices_include_vat: params.pricesIncludeVat,
    })
    .eq("id", params.jobId);

  if (jobError) {
    console.warn("syncJobFromNewQuoteIfEmptyJobLines: update jobs", jobError);
  }
}
