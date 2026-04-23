import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Quote, QuoteLine, QuoteStatus } from "@/types";
import { buildQuotePdfFileKey, uploadFileToR2 } from "@/lib/r2-storage";
import { labelJobStatus, labelQuoteStatus } from "@/lib/activity-labels";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { syncJobFromNewQuoteIfEmptyJobLines } from "@/lib/sync-job-from-quote";

type QuoteRow = {
  id: string;
  job_id: string;
  quote_number: string;
  version_number: number;
  is_final?: boolean | null;
  prices_include_vat?: boolean | null;
  status: QuoteStatus;
  total_amount: number;
  note?: string | null;
  file_url?: string | null;
  file_storage_key?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  quote_lines?: {
    id: string;
    quote_id: string;
    sort_order: number;
    description: string;
    quantity: number;
    unit_price: number;
  }[];
};

export type CreateQuoteInput = {
  jobId: string;
  totalAmount: number;
  pricesIncludeVat: boolean;
  lines: Array<{ description: string; quantity: number; unitPrice: number }>;
  note?: string;
  isFinalOffer?: boolean;
  pdfFile?: File;
  authorId?: string | null;
};

function mapQuoteRow(row: QuoteRow): Quote {
  const lines: QuoteLine[] = (row.quote_lines ?? [])
    .map((line) => ({
      id: line.id,
      quoteId: line.quote_id,
      sortOrder: Number(line.sort_order) || 0,
      description: line.description || "",
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unit_price) || 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    id: row.id,
    jobId: row.job_id,
    quoteNumber: row.quote_number,
    versionNumber: Number(row.version_number) || 1,
    isFinalOffer:
      row.is_final === true ||
      (typeof row.note === "string" && row.note.trim().toLowerCase().startsWith("[final]")),
    pricesIncludeVat: row.prices_include_vat !== false,
    status: row.status,
    totalAmount: Number(row.total_amount) || 0,
    note: row.note ?? undefined,
    fileUrl: row.file_url ?? undefined,
    fileStorageKey: row.file_storage_key ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines,
  };
}

function makeQuoteFileName(file: File): string {
  const ext = file.name.split(".").pop() || "pdf";
  return `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext.toLowerCase()}`;
}

async function fetchJobStatus(jobId: string): Promise<string | null> {
  const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).single();
  if (error) throw error;
  return typeof data?.status === "string" ? data.status : null;
}

function sumLineAmounts(lines: { quantity: number; unitPrice: number }[]): number {
  return lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
}

/**
 * Kreira prvu verziju ponude (v1) iz istih stavki kao i posao, npr. odmah posle `jobs` + `job_quote_lines`.
 * Ne baca grešku — vraća rezultat da pozivalac može da upozori korisnika bez poništenja kreiranog posla.
 */
export async function insertInitialQuoteForNewJob(params: {
  jobId: string;
  quoteLines: { description: string; quantity: number; unitPrice: number; sortOrder?: number }[];
  pricesIncludeVat: boolean;
  authorId: string | null;
}): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }> {
  const lines = params.quoteLines
    .map((l) => ({
      description: l.description?.trim() ?? "",
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    }))
    .filter((l) => l.description.length > 0 && l.quantity > 0);

  if (lines.length === 0) {
    return { ok: false, error: "Nema ispravnih stavki za ponudu" };
  }

  const totalAmount = sumLineAmounts(lines);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { ok: false, error: "Ukupna cena stavki mora biti > 0" };
  }

  const rowFull = {
    job_id: params.jobId,
    total_amount: totalAmount,
    prices_include_vat: params.pricesIncludeVat,
    created_by: params.authorId ?? null,
  };
  const rowMinimal = {
    job_id: params.jobId,
    total_amount: totalAmount,
    created_by: params.authorId ?? null,
  };

  let ins = await supabase.from("quotes").insert([rowFull]).select("id").single();
  if (ins.error) {
    ins = await supabase.from("quotes").insert([rowMinimal]).select("id").single();
  }
  if (ins.error) {
    return { ok: false, error: ins.error.message };
  }
  const createdId = (ins.data as { id: string }).id;

  if (!createdId) return { ok: false, error: "Nije dobijen ID ponude" };

  const { error: linesError } = await supabase.from("quote_lines").insert(
    lines.map((line, idx) => ({
      quote_id: createdId,
      sort_order: idx,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
    })),
  );
  if (linesError) {
    return { ok: false, error: linesError.message };
  }

  const { data: fullQuote, error: fullErr } = await supabase
    .from("quotes")
    .select("id, quote_number, version_number, total_amount")
    .eq("id", createdId)
    .single();
  if (fullErr) {
    return { ok: true, quoteId: createdId };
  }

  const qn = fullQuote as { quote_number?: string; version_number?: number; total_amount?: number };
  await upsertSystemActivity({
    jobId: params.jobId,
    description: `Kreirana ponuda ${qn.quote_number ?? ""} (v${qn.version_number ?? 1}) — ${Number(qn.total_amount) || totalAmount} (iz unosa posla)`,
    systemKey: `quote-created-initial:${createdId}`,
    authorId: params.authorId ?? null,
  });

  try {
    await recomputeJobStatus(params.jobId, params.authorId ?? null);
  } catch (err) {
    console.warn("insertInitialQuoteForNewJob: recomputeJobStatus", err);
  }

  return { ok: true, quoteId: createdId };
}

export function useQuotes(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(jobId);

  const quotes = useQuery({
    queryKey: ["quotes", jobId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, quote_lines(*)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapQuoteRow(row as QuoteRow));
    },
  });

  const createQuote = useMutation({
    mutationFn: async (input: CreateQuoteInput) => {
      let fileUrl: string | null = null;
      let fileStorageKey: string | null = null;

      if (input.pdfFile) {
        const uniqueName = makeQuoteFileName(input.pdfFile);
        fileStorageKey = buildQuotePdfFileKey(input.jobId, uniqueName);
        fileUrl = await uploadFileToR2(fileStorageKey, input.pdfFile);
      }

      const normalizedNote =
        input.isFinalOffer && input.note?.trim()
          ? `[FINAL] ${input.note.trim()}`
          : input.isFinalOffer
            ? "[FINAL] Finalna ponuda"
            : input.note?.trim() || null;

      const { data, error } = await supabase
        .from("quotes")
        .insert([
          {
            job_id: input.jobId,
            total_amount: input.totalAmount,
            prices_include_vat: input.pricesIncludeVat,
            note: normalizedNote,
            is_final: input.isFinalOffer === true ? true : undefined,
            file_url: fileUrl,
            file_storage_key: fileStorageKey,
            created_by: input.authorId ?? null,
          },
        ])
        .select("*, quote_lines(*)")
        .single();
      let createdQuote = data;
      if (error) {
        // Backward-compatible fallback: older DB schema may not have `is_final`.
        const fallback = await supabase
          .from("quotes")
          .insert([
            {
              job_id: input.jobId,
              total_amount: input.totalAmount,
              prices_include_vat: input.pricesIncludeVat,
              note: normalizedNote,
              file_url: fileUrl,
              file_storage_key: fileStorageKey,
              created_by: input.authorId ?? null,
            },
          ])
          .select("*, quote_lines(*)")
          .single();
        if (fallback.error) throw fallback.error;
        createdQuote = fallback.data;
      }

      if (input.lines.length > 0) {
        const { error: linesError } = await supabase.from("quote_lines").insert(
          input.lines.map((line, idx) => ({
            quote_id: createdQuote.id,
            sort_order: idx,
            description: line.description.trim(),
            quantity: line.quantity,
            unit_price: line.unitPrice,
          })),
        );
        if (linesError) throw linesError;
      }

      const { data: fullQuote, error: fullQuoteError } = await supabase
        .from("quotes")
        .select("*, quote_lines(*)")
        .eq("id", createdQuote.id)
        .single();
      if (fullQuoteError) throw fullQuoteError;

      const mapped = mapQuoteRow(fullQuote as QuoteRow);

      await syncJobFromNewQuoteIfEmptyJobLines({
        jobId: input.jobId,
        lines: input.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        pricesIncludeVat: input.pricesIncludeVat,
      });

      await upsertSystemActivity({
        jobId: input.jobId,
        description: `Kreirana ponuda ${mapped.quoteNumber} (v${mapped.versionNumber}) — ${mapped.totalAmount}`,
        systemKey: `quote-created:${mapped.id}`,
        authorId: input.authorId ?? null,
      });
      if (mapped.fileUrl) {
        await upsertSystemActivity({
          jobId: input.jobId,
          description: `Otpremljen PDF za ponudu ${mapped.quoteNumber}`,
          systemKey: `quote-pdf-uploaded:${mapped.id}`,
          authorId: input.authorId ?? null,
        });
      }
      try {
        await recomputeJobStatus(input.jobId, input.authorId ?? null);
      } catch (err) {
        console.warn("Auto status recompute failed after quote creation:", err);
      }
      return mapped;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      toast.success("Ponuda je uspešno kreirana");
    },
    onError: (err: Error) => {
      toast.error("Greška pri kreiranju ponude", { description: err.message });
    },
  });

  const updateQuoteStatus = useMutation({
    mutationFn: async ({
      quoteId,
      jobId: targetJobId,
      status,
      authorId,
    }: {
      quoteId: string;
      jobId: string;
      status: QuoteStatus;
      authorId?: string | null;
    }) => {
      const { data: current, error: currentError } = await supabase
        .from("quotes")
        .select("id, quote_number, status")
        .eq("id", quoteId)
        .single();
      if (currentError) throw currentError;
      if (!current) throw new Error("Ponuda nije pronađena");
      if (current.status === status) return { skipped: true };

      const beforeJobStatus = await fetchJobStatus(targetJobId);

      if (status === "accepted") {
        const { error: clearAcceptedError } = await supabase
          .from("quotes")
          .update({ status: "sent" })
          .eq("job_id", targetJobId)
          .neq("id", quoteId)
          .eq("status", "accepted");
        if (clearAcceptedError) throw clearAcceptedError;
      }

      const { data: updated, error } = await supabase
        .from("quotes")
        .update({ status })
        .eq("id", quoteId)
        .select("id, quote_number, status")
        .single();
      if (error) throw error;

      await upsertSystemActivity({
        jobId: targetJobId,
        description: `Status ponude ${updated.quote_number}: ${labelQuoteStatus(current.status)} -> ${labelQuoteStatus(status)}`,
        systemKey: `quote-status:${quoteId}:${status}`,
        authorId: authorId ?? null,
      });

      try {
        await recomputeJobStatus(targetJobId, authorId ?? null);
      } catch (err) {
        console.warn("Auto status recompute failed after quote status change:", err);
      }

      const afterJobStatus = await fetchJobStatus(targetJobId);
      if (beforeJobStatus && afterJobStatus && beforeJobStatus !== afterJobStatus) {
        await upsertSystemActivity({
          jobId: targetJobId,
          description: `Status posla promenjen zbog ponude: ${labelJobStatus(beforeJobStatus)} -> ${labelJobStatus(afterJobStatus)}`,
          systemKey: `quote-job-status:${targetJobId}:${beforeJobStatus}:${afterJobStatus}`,
          authorId: authorId ?? null,
        });
      }

      return { skipped: false };
    },
    onSuccess: (result, variables) => {
      if (result?.skipped) return;
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      toast.success("Status ponude je ažuriran");
    },
    onError: (err: Error) => {
      toast.error("Greška pri promeni statusa ponude", { description: err.message });
    },
  });

  return {
    quotes: quotes.data ?? [],
    isLoading: quotes.isLoading,
    createQuote,
    updateQuoteStatus,
  };
}
