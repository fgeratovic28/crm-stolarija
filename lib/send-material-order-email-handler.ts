import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { readEnv, requireEnv } from "./read-env.js";
import { buildProcurementSupplierEmailHtml } from "./procurement-supplier-email-html.js";

/** Usklađeno sa `src/lib/material-order-pdf-upload.ts`. */
const MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF = "narudzbenica-autogenerisano.pdf";

export type SendMaterialOrderEmailPayload = {
  orderId: string;
  subject: string;
  message: string;
  signature: string;
};

function procurementResendFrom(): string {
  const raw = readEnv("RESEND_PROCUREMENT_FROM_EMAIL");
  if (!raw) return "Termo Plast Nabavka <ivan@nabavka.crmtermoplast.online>";
  if (raw.includes("<") && raw.includes(">")) return raw;
  return `Termo Plast Nabavka <${raw}>`;
}

function procurementResendReplyTo(): string | undefined {
  return readEnv("RESEND_PROCUREMENT_REPLY_TO") || "fgeratovic03@gmail.com";
}

async function fetchPdfAttachmentFromUrl(url: string, filename: string): Promise<{ filename: string; content: string }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "CRM-TermoPlast-ProcurementEmail/1.0",
      Accept: "application/pdf,application/octet-stream,*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`PDF prilog nije dostupan (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return {
    filename,
    content: Buffer.from(bytes).toString("base64"),
  };
}

export function isSendMaterialOrderEmailPayload(input: unknown): input is SendMaterialOrderEmailPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const p = input as Record<string, unknown>;
  if (typeof p.orderId !== "string" || !p.orderId.trim()) return false;
  if (typeof p.subject !== "string" || !p.subject.trim() || p.subject.length > 300) return false;
  if (typeof p.message !== "string" || p.message.length > 15_000) return false;
  if (typeof p.signature !== "string" || !p.signature.trim() || p.signature.length > 5_000) return false;
  return true;
}

export async function runSendMaterialOrderEmailHandler(
  body: SendMaterialOrderEmailPayload,
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

  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = requireEnv("RESEND_PROCUREMENT_API_KEY");
  const resendFrom = procurementResendFrom();
  const replyTo = procurementResendReplyTo();

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

  const { data: orderRow, error: orderErr } = await serverSupabase
    .from("material_orders")
    .select(
      `
      id,
      job_id,
      supplier,
      delivery_status,
      suppliers ( email ),
      jobs ( job_number )
    `,
    )
    .eq("id", body.orderId.trim())
    .maybeSingle();

  if (orderErr) {
    return { status: 500, body: { ok: false, error: orderErr.message } };
  }
  if (!orderRow) {
    return { status: 404, body: { ok: false, error: "Narudžbina nije pronađena." } };
  }

  const supplierRel = Array.isArray(orderRow.suppliers) ? orderRow.suppliers[0] : orderRow.suppliers;
  const supplierEmail = String((supplierRel as { email?: string } | null)?.email ?? "").trim();
  if (!supplierEmail) {
    return { status: 400, body: { ok: false, error: "Dobavljač nema email adresu u šifarniku." } };
  }

  const { data: fileRows, error: filesErr } = await serverSupabase
    .from("files")
    .select("filename, storage_url, storage_key, uploaded_at")
    .eq("material_order_id", body.orderId.trim())
    .order("uploaded_at", { ascending: false });

  if (filesErr) {
    return { status: 500, body: { ok: false, error: filesErr.message } };
  }

  const pdfRow =
    (fileRows ?? []).find((f) => {
      const key = String(f.storage_key ?? "");
      return key === MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF || key.endsWith(`/${MATERIAL_ORDER_GENERATED_PDF_STORAGE_LEAF}`);
    }) ??
    (fileRows ?? []).find((f) => String(f.filename ?? "").toLowerCase().endsWith(".pdf"));

  if (!pdfRow?.storage_url) {
    return {
      status: 400,
      body: {
        ok: false,
        error:
          "Nema PDF porudžbenice u prilozima. Sačekajte da se PDF generiše posle kreiranja narudžbine ili je ponovo generišite štampom.",
      },
    };
  }

  const jobRel = Array.isArray(orderRow.jobs) ? orderRow.jobs[0] : orderRow.jobs;
  const jobNumber = String((jobRel as { job_number?: string } | null)?.job_number ?? "").trim();
  const attachmentFilename =
    String(pdfRow.filename ?? "").trim() ||
    `Porudzbenica_${jobNumber || body.orderId.slice(0, 8)}.pdf`;

  let attachment: { filename: string; content: string };
  try {
    attachment = await fetchPdfAttachmentFromUrl(String(pdfRow.storage_url), attachmentFilename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { ok: false, error: msg } };
  }

  const subject = body.subject.trim();
  const emailHtml = buildProcurementSupplierEmailHtml({
    message: body.message,
    signature: body.signature,
  });

  let emailResult: { data?: { id?: string } | null; error?: { message?: string } | null };
  try {
    const resend = new Resend(resendApiKey);
    emailResult = await resend.emails.send({
      from: resendFrom,
      to: [supplierEmail],
      replyTo: replyTo ? [replyTo] : undefined,
      subject,
      html: emailHtml,
      attachments: [attachment],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 502, body: { ok: false, error: `Resend: ${msg}` } };
  }

  if (emailResult.error) {
    return {
      status: 502,
      body: { ok: false, error: emailResult.error.message || "Slanje mejla nije uspelo." },
    };
  }

  const jobId = (orderRow.job_id as string | null) ?? null;
  const supplierName = String(orderRow.supplier ?? "").trim() || "dobavljač";
  const emailId = emailResult.data?.id?.trim() || `${body.orderId}-${Date.now()}`;

  if (jobId) {
    const { error: actErr } = await serverSupabase.from("activities").insert([
      {
        job_id: jobId,
        type: "email",
        description: `[AUTO] Poslata porudžbina dobavljaču (${supplierName}) — ${subject}`,
        author_id: user.id,
        system_key: `material-order-email:${emailId}`,
        date: new Date().toISOString(),
      },
    ]);
    if (actErr) console.error("activities insert posle slanja porudžbine:", actErr.message);
  }

  const prevStatus = String(orderRow.delivery_status ?? "");
  const { error: upErr } = await serverSupabase
    .from("material_orders")
    .update({ delivery_status: "sent_to_supplier" })
    .eq("id", body.orderId.trim());

  if (upErr) {
    return {
      status: 207,
      body: {
        ok: false,
        error: `Mejl je poslat, ali status narudžbine nije ažuriran: ${upErr.message}`,
        emailId: emailResult.data?.id ?? null,
        previousDeliveryStatus: prevStatus,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      message: "Porudžbina je poslata dobavljaču mejlom.",
      emailId: emailResult.data?.id ?? null,
      recipient: supplierEmail,
    },
  };
}
