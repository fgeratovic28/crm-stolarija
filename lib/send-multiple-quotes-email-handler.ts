import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { normalizeQuoteFileAttachments } from "./normalize-quote-file-attachments.js";

export type SendMultipleQuotesPayload = {
  jobId: string;
  quoteIds: string[];
  message?: string;
  /** Klijentski generisan PDF uplatnice (base64), uz priloge ponuda. */
  includePaymentSlip?: boolean;
  paymentSlipPdfBase64?: string;
  paymentSlipFilename?: string;
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function guessExtensionFromUrl(url: string, contentType: string | null): string {
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".pdf")) return ".pdf";
  if (lower.endsWith(".xlsx")) return ".xlsx";
  if (lower.endsWith(".xls")) return ".xls";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("spreadsheetml")) return ".xlsx";
  if (ct.includes("ms-excel")) return ".xls";
  return ".pdf";
}

function safeFileBase(s: string): string {
  return s.replace(/[^\w\u0400-\u04FF.-]+/g, "_").replace(/_+/g, "_").slice(0, 80) || "ponuda";
}

function resolveQuoteAttachmentFilename(
  originalFilename: string | undefined,
  url: string,
  contentType: string | null,
  fallbackBase: string,
): string {
  const ext = guessExtensionFromUrl(url, contentType);
  const raw = originalFilename?.trim();
  if (raw) {
    const safe = safeFileBase(raw.replace(/[/\\]+/g, "_"));
    const lower = safe.toLowerCase();
    if (lower.endsWith(ext)) return safe.slice(0, 200);
    if (/\.(pdf|xlsx|xls)$/i.test(safe)) return safe.slice(0, 200);
    return `${safe}${ext}`.slice(0, 200);
  }
  return `${fallbackBase}${ext}`.slice(0, 200);
}

async function fetchUrlAsQuoteAttachment(params: {
  url: string;
  originalFilename?: string;
  jobSlug: string;
  optionIndex: number;
}): Promise<{ filename: string; content: string; isPdf: boolean }> {
  const response = await fetch(params.url, {
    redirect: "follow",
    headers: {
      "User-Agent": "CRM-TermoPlast-BulkQuote/2.0",
      Accept: "application/pdf,application/octet-stream,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Prilog nije dostupan (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  const ct = response.headers.get("content-type");
  const fallbackBase = `Ponuda_${params.jobSlug}_Opcija_${params.optionIndex}`;
  const filename = resolveQuoteAttachmentFilename(params.originalFilename, params.url, ct, fallbackBase);
  const isPdf = filename.toLowerCase().endsWith(".pdf") || (ct ?? "").toLowerCase().includes("pdf");
  return {
    filename,
    content: Buffer.from(bytes).toString("base64"),
    isPdf,
  };
}

/** Stari naziv — ostaje zbog kompatibilnosti ako negde još poziva sequential varijantu. */
async function fetchUrlAsSequentialQuoteAttachment(
  params: Parameters<typeof fetchUrlAsQuoteAttachment>[0],
): Promise<Awaited<ReturnType<typeof fetchUrlAsQuoteAttachment>>> {
  return fetchUrlAsQuoteAttachment(params);
}

function slugJobNumberForFiles(jobNumber: string): string {
  return safeFileBase(jobNumber.replace(/\s+/g, "_")).replace(/_+/g, "_") || "Posao";
}

const MEMORANDUM_PNG = "memorandum.png";

function memorandumPngAbsolutePaths(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(process.cwd(), "public", MEMORANDUM_PNG),
    path.join(moduleDir, "..", "public", MEMORANDUM_PNG),
  ];
}

/** Slika iz `public/memorandum.png`: inline CID (Radi u mejlu bez javnog URL-a) ili apsolutni URL. */
function resolveMemorandumForQuoteEmail(): {
  imgSrcForHtml: string;
  /** Resend Node `parseAttachments` koristi camelCase (`contentId`, `contentType`), ne snake_case. */
  inlineAttachment?: { filename: string; content: string; contentType: string; contentId: string };
} {
  for (const pngPath of memorandumPngAbsolutePaths()) {
    try {
      if (!existsSync(pngPath)) continue;
      const content = readFileSync(pngPath).toString("base64");
      return {
        imgSrcForHtml: "cid:memorandum",
        inlineAttachment: {
          filename: MEMORANDUM_PNG,
          content,
          contentType: "image/png",
          contentId: "memorandum",
        },
      };
    } catch {
      /* try next path */
    }
  }
  const base = [process.env.NEXT_PUBLIC_APP_URL, process.env.VITE_PUBLIC_APP_URL]
    .map((s) => String(s ?? "").trim().replace(/\/$/, ""))
    .find(Boolean);
  const vercelHost = process.env.VERCEL_URL?.trim().replace(/^https?:\/\//, "") ?? "";
  const origin = base || (vercelHost ? `https://${vercelHost}` : "");
  const fallbackUrl = origin ? `${origin}/${MEMORANDUM_PNG}` : `/${MEMORANDUM_PNG}`;
  return { imgSrcForHtml: fallbackUrl };
}

function buildOutgoingQuoteBulkEmailHtml(input: {
  customerName: string;
  documentCount: number;
  memorandumImgSrc: string;
  messageHtml?: string;
  includePaymentSlip: boolean;
}): string {
  const customerName = escapeHtml(input.customerName);
  const memorandumSrc = escapeHtml(input.memorandumImgSrc);
  const msgBlock = input.messageHtml
    ? `<p style="margin:14px 0 0;color:#1e293b;font-size:15px;line-height:24px;">${input.messageHtml}</p>`
    : "";
  const slipNote = input.includePaymentSlip
    ? `<p style="margin:12px 0 0;color:#1e293b;font-size:15px;line-height:22px;">U prilogu se nalazi i <strong>nalog za uplatu</strong> (PDF) — polje za iznos ostaje prazno kako biste ručno upisali avans.</p>`
    : "";
  const bodyParagraphs =
    input.documentCount === 1
      ? `<p style="color: #1e3a8a; font-size: 16px;">Poštovani/a <strong>${customerName}</strong>,</p>
<p>U prilogu Vam dostavljamo ponudu za izradu i ugradnju stolarije za Vaš projekat.</p>
<p>Molimo Vas da pregledate priloženi dokument.</p>`
      : `<p style="color: #1e3a8a; font-size: 16px;">Poštovani/a <strong>${customerName}</strong>,</p>
<p>U prilogu Vam dostavljamo ponudu za izradu i ugradnju stolarije za Vaš projekat.</p>
<p>Ponuda sadrži više priloga (dokumenata), pa Vas molimo da ih sve pregledate i javite nam za koju varijantu ste se odlučili.</p>`;
  return `<!doctype html>
<html lang="sr">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8fafc;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;"><tr><td align="center">
      <div style="max-width:600px;margin:0 auto;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <img src="${memorandumSrc}" alt="TermoPlast" style="width: 100%; max-width: 600px; height: auto; display: block; border: 0;" />
        <hr style="border: 0; border-top: 3px solid #1e3a8a; margin: 0;" />
        <div style="padding: 30px 20px; color: #374151; font-family: sans-serif; line-height: 1.6; text-align: left;">
        ${bodyParagraphs}
        ${slipNote}
        ${msgBlock}
        <p>Za sva dodatna pitanja, stojimo Vam na raspolaganju.</p>
        <p style="color: #1e3a8a;"><strong>Srdačan pozdrav,</strong><br><span style="color: #dc2626;">TermoPlast</span> D.O.O.</p></div>
      </div>
    </td></tr></table>
  </body>
</html>`;
}

export function isSendMultipleQuotesPayload(input: unknown): input is SendMultipleQuotesPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const p = input as Record<string, unknown>;
  if (typeof p.jobId !== "string" || !p.jobId.trim()) return false;
  if (!Array.isArray(p.quoteIds) || p.quoteIds.length === 0) return false;
  if (!p.quoteIds.every((id) => typeof id === "string" && id.trim().length > 0)) return false;
  if (p.quoteIds.length > 25) return false;
  if (p.message !== undefined && typeof p.message !== "string") return false;
  if (p.includePaymentSlip !== undefined && typeof p.includePaymentSlip !== "boolean") return false;
  if (p.paymentSlipPdfBase64 !== undefined && typeof p.paymentSlipPdfBase64 !== "string") return false;
  if (p.paymentSlipFilename !== undefined && typeof p.paymentSlipFilename !== "string") return false;
  if (p.includePaymentSlip === true) {
    const b64 = String(p.paymentSlipPdfBase64 ?? "").replace(/\s/g, "");
    if (b64.length < 400) return false;
    if (b64.length > 14_000_000) return false;
    const fn = String(p.paymentSlipFilename ?? "").trim().toLowerCase();
    if (!fn.endsWith(".pdf") || fn.length < 5 || fn.length > 200) return false;
  }
  return true;
}

export async function runSendMultipleQuotesEmailHandler(
  body: SendMultipleQuotesPayload,
  bearer: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl) {
    throw new Error("Missing environment variable: VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!anonKey) {
    throw new Error("Missing environment variable: VITE_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = getEnv("RESEND_API_KEY");
  const resendFrom = process.env.RESEND_FROM_EMAIL || "Termo Plast CRM <onboarding@resend.dev>";

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(bearer);
  if (authError || !user) {
    return { status: 401, body: { ok: false, error: "Unauthorized." } };
  }

  const serverSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: qErr } = await serverSupabase
    .from("quotes")
    .select(
      "id, job_id, quote_number, version_number, version_name, total_amount, file_url, file_storage_key, file_attachments, status, is_final",
    )
    .eq("job_id", body.jobId)
    .in("id", body.quoteIds);

  if (qErr) {
    return { status: 500, body: { ok: false, error: qErr.message } };
  }
  const list = rows ?? [];
  if (list.length !== body.quoteIds.length) {
    return {
      status: 400,
      body: { ok: false, error: "Jedna ili više ponuda ne pripadaju ovom poslu ili ne postoje." },
    };
  }

  const rowList = list as Array<{
    id: string;
    quote_number?: string | null;
    version_name?: string | null;
    file_url?: string | null;
    file_storage_key?: string | null;
    file_attachments?: unknown;
    is_final?: boolean | null;
  }>;

  for (const r of rowList) {
    const att = normalizeQuoteFileAttachments(r.file_attachments, r.file_url, r.file_storage_key);
    if (att.length === 0) {
      return {
        status: 400,
        body: { ok: false, error: `Ponuda ${r.quote_number ?? r.id} nema priložen fajl (URL).` },
      };
    }
  }

  const { data: jobForEmailSend, error: jobErr } = await serverSupabase
    .from("jobs")
    .select("id, job_number, status, parent_job_id, customer_id, customers(name, emails)")
    .eq("id", body.jobId)
    .maybeSingle();

  if (jobErr) {
    return { status: 500, body: { ok: false, error: jobErr.message } };
  }
  if (!jobForEmailSend) {
    return { status: 404, body: { ok: false, error: "Posao nije pronađen." } };
  }

  const rawC = jobForEmailSend.customers as { name?: string; emails?: unknown } | { name?: string; emails?: unknown }[] | null;
  const customers = Array.isArray(rawC) ? rawC[0] : rawC;
  const customerName = (customers?.name ?? "Klijent").trim() || "Klijent";
  const emailsRaw = customers?.emails;
  const emails = Array.isArray(emailsRaw)
    ? emailsRaw.map((e) => String(e).trim()).filter(Boolean)
    : typeof emailsRaw === "string"
      ? [emailsRaw.trim()].filter(Boolean)
      : [];
  const customerEmail = emails[0] ?? "";
  if (!customerEmail) {
    return { status: 400, body: { ok: false, error: "Kupac nema email adresu u bazi." } };
  }

  const jobNumber = String(jobForEmailSend.job_number ?? body.jobId);
  const jobSlug = slugJobNumberForFiles(jobNumber);
  const jobStatusBeforeSend = String((jobForEmailSend as { status?: string }).status ?? "");
  const isChildJob =
    typeof (jobForEmailSend as { parent_job_id?: string | null }).parent_job_id === "string" &&
    ((jobForEmailSend as { parent_job_id: string }).parent_job_id?.length ?? 0) > 0;
  const sendingFinalQuote = rowList.some((r) => r.is_final === true);
  const nextJobStatus =
    isChildJob || (jobStatusBeforeSend !== "measurement_processing" && !sendingFinalQuote)
      ? "quote_sent"
      : "final_quote_sent";

  const attachments: { filename: string; content: string }[] = [];
  let sequentialOptionIndex = 0;
  let pdfAttachmentsCount = 0;
  for (const r of rowList) {
    const attList = normalizeQuoteFileAttachments(r.file_attachments, r.file_url, r.file_storage_key);
    for (const _a of attList) {
      sequentialOptionIndex += 1;
      const built = await fetchUrlAsQuoteAttachment({
        url: _a.url,
        originalFilename: _a.filename,
        jobSlug,
        optionIndex: sequentialOptionIndex,
      });
      attachments.push({ filename: built.filename, content: built.content });
      if (built.isPdf) {
        pdfAttachmentsCount += 1;
      }
    }
  }

  let paymentSlipAttached = false;
  if (body.includePaymentSlip === true) {
    const rawB64 = String(body.paymentSlipPdfBase64 ?? "").replace(/\s/g, "");
    const rawName = String(body.paymentSlipFilename ?? "").trim();
    if (rawB64.length < 400 || !rawName.toLowerCase().endsWith(".pdf")) {
      return {
        status: 400,
        body: { ok: false, error: "Nedostaje ispravan PDF uplatnice (priloga)." },
      };
    }
    attachments.push({
      filename: safeFileBase(rawName),
      content: rawB64,
    });
    pdfAttachmentsCount += 1;
    paymentSlipAttached = true;
  }

  const documentCountForEmail = attachments.length;

  const messagePlain = body.message?.trim() ?? "";
  const messageHtml =
    messagePlain.length > 0
      ? escapeHtml(messagePlain).replaceAll("\r\n", "\n").replaceAll("\n", "<br/>")
      : undefined;

  const memorandum = resolveMemorandumForQuoteEmail();
  const emailHtml = buildOutgoingQuoteBulkEmailHtml({
    customerName,
    documentCount: documentCountForEmail,
    memorandumImgSrc: memorandum.imgSrcForHtml,
    messageHtml,
    includePaymentSlip: paymentSlipAttached,
  });

  const emailSubject = `Ponuda za stolariju - ${customerName} - ${jobNumber}`;

  const emailAttachments = memorandum.inlineAttachment
    ? [memorandum.inlineAttachment, ...attachments]
    : attachments;

  let emailResult: { data?: { id?: string } | null; error?: { message?: string } | null };
  try {
    const resend = new Resend(resendApiKey);
    emailResult = await resend.emails.send({
      from: resendFrom,
      to: [customerEmail],
      subject: emailSubject,
      html: emailHtml,
      attachments: emailAttachments,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 502,
      body: { ok: false, error: `Resend / prilozi: ${msg}` },
    };
  }

  if (emailResult.error) {
    return {
      status: 502,
      body: { ok: false, error: emailResult.error.message || "Slanje mejla nije uspelo." },
    };
  }

  let activityDescription: string;
  if (pdfAttachmentsCount >= 2) {
    activityDescription = `[AUTO] Klijentu je poslata ponuda sa ${pdfAttachmentsCount} varijante.`;
  } else if (pdfAttachmentsCount === 1) {
    activityDescription = "[AUTO] Klijentu je poslata ponuda (1 varijanta).";
  } else {
    const fallback = sequentialOptionIndex <= 1 ? 1 : sequentialOptionIndex;
    activityDescription =
      fallback <= 1
        ? "[AUTO] Klijentu je poslata ponuda (1 varijanta)."
        : `[AUTO] Klijentu je poslata ponuda sa ${fallback} varijante.`;
  }
  if (paymentSlipAttached) {
    activityDescription += " Priložen i nalog za uplatu.";
  }
  const uniq = Math.random().toString(36).slice(2, 12);
  const emailKey = emailResult.data?.id?.trim() || `${body.jobId}-${Date.now()}`;
  const { error: actErr } = await serverSupabase.from("activities").insert([
    {
      job_id: body.jobId,
      type: "email",
      description: activityDescription,
      author_id: user.id,
      system_key: `quote-bulk-send:${emailKey}:${uniq}`,
      date: new Date().toISOString(),
    },
  ]);
  if (actErr) {
    console.error("activities insert posle slanja ponude:", actErr.message);
  }

  const { error: upQuotesErr } = await serverSupabase
    .from("quotes")
    .update({ status: "sent", delivery_method: "email_system" })
    .eq("job_id", body.jobId)
    .in("id", body.quoteIds);

  if (upQuotesErr) {
    return {
      status: 207,
      body: {
        ok: false,
        error: `Mejl je poslat, ali status ponuda nije ažuriran: ${upQuotesErr.message}`,
        emailId: emailResult.data?.id ?? null,
      },
    };
  }

  const { error: upJobErr } = await serverSupabase.from("jobs").update({ status: nextJobStatus }).eq("id", body.jobId);

  if (upJobErr) {
    return {
      status: 207,
      body: {
        ok: false,
        error: `Mejl je poslat i ponude su označene kao poslate, ali status posla nije ažuriran: ${upJobErr.message}`,
        emailId: emailResult.data?.id ?? null,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      message:
        nextJobStatus === "final_quote_sent"
          ? "Ponude su poslate klijentu; status posla: Poslata finalna ponuda."
          : "Ponude su poslate klijentu; status posla: Ponuda poslata.",
      emailId: emailResult.data?.id ?? null,
    },
  };
}
