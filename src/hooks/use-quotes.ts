import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Quote, QuoteDeliveryMethod, QuoteStatus } from "@/types";
import { parseQuoteDeliveryMethod, labelQuoteDeliveryMethod } from "@/lib/quote-delivery-method";
import { normalizeDbQuoteAttachments } from "@/lib/quote-attachments";
import { labelJobStatus, labelQuoteStatus } from "@/lib/activity-labels";
import { upsertSystemActivity } from "@/lib/activity-automation";
import { recomputeJobStatus } from "@/lib/job-status-automation";
import { invalidateFilesStorageUsage } from "@/lib/files-storage-usage";
import { buildQuotePdfFileKey, deleteObjectFromR2, uploadFileToR2 } from "@/lib/r2-storage";
import { acceptQuote } from "@/actions/accept-quote";
import type { VatRatePercent } from "@/lib/vat-constants";
import { DEFAULT_OUTGOING_VAT_RATE_PERCENT } from "@/lib/vat-constants";

type QuoteRow = {
  id: string;
  job_id: string;
  quote_number: string;
  version_number: number;
  version_name?: string | null;
  is_final?: boolean | null;
  is_addon_work?: boolean | null;
  prices_include_vat?: boolean | null;
  vat_rate_percent?: number | null;
  status: QuoteStatus;
  delivery_method?: string | null;
  total_amount: number;
  note?: string | null;
  file_url?: string | null;
  file_storage_key?: string | null;
  file_attachments?: unknown;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateQuoteInput = {
  jobId: string;
  versionName: string;
  /** Po kreiranju ostaje 0 dok se ponuda ne prihvati ili ručno ne unese iznos. */
  totalAmount?: number;
  /** Jedan ili više priloga za istu ponudu. */
  files: File[];
  /** Stopa PDV (podrazumevano 20% za nove ponude). */
  vatRatePercent?: VatRatePercent;
  pricesIncludeVat?: boolean;
  authorId?: string | null;
  /** Dopunska ponuda (ne menja status posla pri prihvatanju). */
  isAddonWork?: boolean;
  /** Finalna ponuda (post-merni tok, status posla final_quote_*). */
  isFinalOffer?: boolean;
};

function mapQuoteRow(row: QuoteRow): Quote {
  const fileAttachments = normalizeDbQuoteAttachments(
    row.file_attachments,
    row.file_url,
    row.file_storage_key,
  );
  const primary = fileAttachments[0];

  return {
    id: row.id,
    jobId: row.job_id,
    quoteNumber: row.quote_number,
    versionNumber: Number(row.version_number) || 1,
    versionName: row.version_name?.trim() || undefined,
    isFinalOffer:
      row.is_final === true ||
      (typeof row.note === "string" && row.note.trim().toLowerCase().startsWith("[final]")),
    isAddonWork: row.is_addon_work === true,
    pricesIncludeVat: row.prices_include_vat !== false,
    vatRatePercent: Number(row.vat_rate_percent) === 20 ? 20 : 0,
    status: row.status,
    deliveryMethod: parseQuoteDeliveryMethod(row.delivery_method),
    totalAmount: Number(row.total_amount) || 0,
    note: row.note ?? undefined,
    fileAttachments,
    fileUrl: primary?.url ?? row.file_url ?? undefined,
    fileStorageKey: primary?.storageKey ?? row.file_storage_key ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: [],
  };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function sanitizeStorageFileName(name: string): string {
  const base = name.replace(/[^\w.\u0400-\u04FF()-]+/g, "_").replace(/_+/g, "_");
  return base.length > 0 ? base.slice(0, 120) : "upload";
}

function makeQuoteUploadObjectName(file: File): string {
  const name = file.name.trim() || "document.pdf";
  const lastDot = name.lastIndexOf(".");
  const ext = lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : "pdf";
  const base = lastDot >= 0 ? name.slice(0, lastDot) : name;
  return `${randomId()}_${sanitizeStorageFileName(base)}.${ext || "pdf"}`;
}

async function uploadQuoteDocumentToR2(jobId: string, file: File): Promise<{ path: string; publicUrl: string }> {
  const uniqueName = makeQuoteUploadObjectName(file);
  const path = buildQuotePdfFileKey(jobId, uniqueName);
  const publicUrl = await uploadFileToR2(path, file);
  return { path, publicUrl };
}

async function fetchJobStatus(jobId: string): Promise<string | null> {
  const { data, error } = await supabase.from("jobs").select("status").eq("id", jobId).single();
  if (error) throw error;
  return typeof data?.status === "string" ? data.status : null;
}

async function fetchQuotesForJob(jobId: string): Promise<Quote[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => mapQuoteRow(row as QuoteRow));
}

export function useQuotes(jobId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(jobId);

  const quotes = useQuery({
    queryKey: ["quotes", jobId],
    enabled,
    queryFn: async () => {
      if (!jobId) return [];
      return fetchQuotesForJob(jobId);
    },
  });

  const createQuote = useMutation({
    mutationFn: async (input: CreateQuoteInput) => {
      if (input.files.length < 1) {
        throw new Error("Izaberite bar jedan fajl.");
      }
      const uploaded: Array<{ path: string; publicUrl: string }> = [];
      try {
        for (const f of input.files) {
          uploaded.push(await uploadQuoteDocumentToR2(input.jobId, f));
        }
      } catch (e) {
        await Promise.all(
          uploaded.map((u) => deleteObjectFromR2(u.path).catch(() => undefined)),
        );
        throw e;
      }

      const fileAttachments = input.files.map((file, i) => {
        const u = uploaded[i]!;
        const fname = (typeof file.name === "string" ? file.name : "").trim();
        return {
          url: u.publicUrl,
          storage_key: u.path,
          filename: fname ? fname.slice(0, 240) : null,
          size_bytes: typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0,
        };
      });
      const attachments_total_bytes = fileAttachments.reduce(
        (sum, row) => sum + (Number(row.size_bytes) || 0),
        0,
      );
      const first = uploaded[0]!;

      const totalAmount = input.totalAmount ?? 0;

      const quoteVat = input.vatRatePercent ?? DEFAULT_OUTGOING_VAT_RATE_PERCENT;

      const rowBase = {
        job_id: input.jobId,
        status: "draft" as const,
        total_amount: totalAmount,
        version_name: input.versionName.trim(),
        prices_include_vat: input.pricesIncludeVat !== false,
        vat_rate_percent: quoteVat,
        file_attachments: fileAttachments,
        attachments_total_bytes,
        file_url: first.publicUrl,
        file_storage_key: first.path,
        created_by: input.authorId ?? null,
        is_addon_work: input.isAddonWork === true,
        is_final: input.isFinalOffer === true,
      };

      const ins = await supabase.from("quotes").insert([rowBase]).select("*").single();
      if (ins.error) {
        await Promise.all(
          uploaded.map((u) => deleteObjectFromR2(u.path).catch(() => undefined)),
        );
        throw ins.error;
      }

      const mapped = mapQuoteRow(ins.data as QuoteRow);

      if (input.isAddonWork !== true) {
        await supabase
          .from("jobs")
          .update({ post_measurement_keep_initial_quote: false })
          .eq("id", input.jobId);
      }

      await upsertSystemActivity({
        jobId: input.jobId,
        description: `Kreirana ponuda ${mapped.quoteNumber} (${mapped.versionName ?? "verzija"})`,
        systemKey: `quote-created:${mapped.id}`,
        authorId: input.authorId ?? null,
      });
      try {
        await recomputeJobStatus(input.jobId, input.authorId ?? null);
      } catch (err) {
        console.warn("Auto status recompute failed after quote creation:", err);
      }
      await queryClient.refetchQueries({ queryKey: ["job", input.jobId] });
      return mapped;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["files", variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["files", "all"] });
      invalidateFilesStorageUsage(queryClient);
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

      if (status === "accepted") {
        throw new Error('Prihvatanje ponude koristi dugme „Označi kao prihvaćenu“ i potvrdu konačne cene.');
      }

      const beforeJobStatus = await fetchJobStatus(targetJobId);

      const { data: updated, error } = await supabase
        .from("quotes")
        .update({ status })
        .eq("id", quoteId)
        .select("id, quote_number, status")
        .single();
      if (error) throw error;

      if (status === "sent") {
        await supabase
          .from("quotes")
          .update({ delivery_method: "other" })
          .eq("id", quoteId)
          .eq("delivery_method", "not_sent");
      }

      await upsertSystemActivity({
        jobId: targetJobId,
        description: `Status ponude ${updated.quote_number}: ${labelQuoteStatus(current.status)} → ${labelQuoteStatus(status)}`,
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
          description: `Status posla promenjen zbog ponude: ${labelJobStatus(beforeJobStatus)} → ${labelJobStatus(afterJobStatus)}`,
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

  const markQuoteDeliveryMethod = useMutation({
    mutationFn: async ({
      quoteId,
      jobId: targetJobId,
      deliveryMethod,
      authorId,
    }: {
      quoteId: string;
      jobId: string;
      deliveryMethod: QuoteDeliveryMethod;
      authorId?: string | null;
    }) => {
      if (deliveryMethod === "not_sent") {
        throw new Error("Izaberite način slanja.");
      }

      const { data: current, error: currentError } = await supabase
        .from("quotes")
        .select("id, quote_number, status, delivery_method")
        .eq("id", quoteId)
        .single();
      if (currentError) throw currentError;
      if (!current) throw new Error("Ponuda nije pronađena");
      if (current.status === "zamenjena") {
        throw new Error("Za ovu (staru) verziju ponude nije moguća evidencija slanja.");
      }

      const beforeJobStatus = await fetchJobStatus(targetJobId);
      const wasDraft = current.status === "draft";
      const patch: { delivery_method: QuoteDeliveryMethod; status?: QuoteStatus } = {
        delivery_method: deliveryMethod,
      };
      if (wasDraft) {
        patch.status = "sent";
      }

      const { data: updated, error } = await supabase
        .from("quotes")
        .update(patch)
        .eq("id", quoteId)
        .select("id, quote_number, status, delivery_method")
        .single();
      if (error) throw error;

      await upsertSystemActivity({
        jobId: targetJobId,
        description: `Evidencija slanja ponude ${updated.quote_number}: ${labelQuoteDeliveryMethod(deliveryMethod)}${
          wasDraft ? " (status: Poslata)" : ""
        }`,
        systemKey: `quote-delivery:${quoteId}:${deliveryMethod}:${Date.now()}`,
        authorId: authorId ?? null,
      });

      if (wasDraft) {
        try {
          await recomputeJobStatus(targetJobId, authorId ?? null);
        } catch (err) {
          console.warn("Auto status recompute failed after marking quote sent:", err);
        }

        const afterJobStatus = await fetchJobStatus(targetJobId);
        if (beforeJobStatus && afterJobStatus && beforeJobStatus !== afterJobStatus) {
          await upsertSystemActivity({
            jobId: targetJobId,
            description: `Status posla promenjen zbog ponude: ${labelJobStatus(beforeJobStatus)} → ${labelJobStatus(afterJobStatus)}`,
            systemKey: `quote-job-status:${targetJobId}:${beforeJobStatus}:${afterJobStatus}`,
            authorId: authorId ?? null,
          });
        }
      }

      return { skipped: false };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      toast.success("Evidencija slanja je sačuvana.");
    },
    onError: (err: Error) => {
      toast.error("Greška pri čuvanju evidencije", { description: err.message });
    },
  });

  const acceptQuoteMutation = useMutation({
    mutationFn: async (input: {
      quoteId: string;
      jobId: string;
      totalPrice?: number;
      vatRatePercent?: number;
      pricesIncludeVat?: boolean;
      authorId?: string | null;
    }) => {
      await acceptQuote(input);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["activities", variables.jobId] });
      void queryClient.invalidateQueries({ queryKey: ["finances-summary"] });
      const priced = typeof variables.totalPrice === "number" && variables.totalPrice > 0;
      toast.success(
        priced ? "Ponuda je prihvaćena; cena na poslu je ažurirana." : "Ponuda je prihvaćena.",
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Prihvatanje ponude nije uspelo.");
    },
  });

  return {
    quotes: quotes.data ?? [],
    isLoading: quotes.isLoading,
    createQuote,
    updateQuoteStatus,
    markQuoteDeliveryMethod,
    acceptQuote: acceptQuoteMutation,
  };
}
