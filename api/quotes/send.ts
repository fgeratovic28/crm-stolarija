import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

type SendQuotePayload = {
  jobId: string;
  customerEmail: string;
  customerName: string;
  quoteNumber: string;
  quoteTotal: number | string;
  pdfBase64?: string;
  pdfUrl?: string;
  attachmentUrl?: string;
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

function buildQuoteEmailHtml(input: {
  customerName: string;
  quoteNumber: string;
  quoteTotal: string;
}): string {
  const customerName = escapeHtml(input.customerName);
  const quoteNumber = escapeHtml(input.quoteNumber);
  const quoteTotal = escapeHtml(input.quoteTotal);
  const appBaseUrl = (process.env.VITE_PUBLIC_APP_URL || "https://crm-stolarija.vercel.app").replace(/\/+$/, "");
  const memorandumUrl = `${appBaseUrl}/memorandum.png`;
  return `<!doctype html>
<html lang="sr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Ponuda ${quoteNumber}</title>
  </head>
  <body bgcolor="#ffffff" style="margin:0;padding:0;background-color:#ffffff !important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff !important;padding:24px 0;">
      <tr>
        <td align="center">
    <div style="max-width:560px;margin:0 auto;background-color:#ffffff !important;border:1px solid #cbd7ee;border-radius:12px;padding:24px;">
      <div style="margin:0 0 18px;text-align:center;">
        <img src="${memorandumUrl}" alt="Termo Plast D.O.O memorandum" style="max-width:100%;height:auto;border:0;display:inline-block;" />
      </div>
      <div style="height:4px;background:linear-gradient(90deg,#c1121f 0%,#c1121f 35%,#1d4ed8 35%,#1d4ed8 100%);border-radius:999px;margin:0 0 16px;"></div>
      <p style="margin:0 0 16px;color:#1e3a8a;font-size:16px;line-height:24px;font-weight:700;">Pozdrav ${customerName},</p>
      <p style="margin:0 0 14px;color:#1e40af;font-size:14px;line-height:22px;">u prilogu Vam saljemo ponudu za trazenu uslugu.</p>
      <div style="background:#f8fbff;border:1px solid #bfd1f3;border-left:4px solid #1d4ed8;border-radius:10px;padding:12px 14px;margin:0 0 14px;">
        <p style="margin:0 0 8px;color:#1e40af;font-size:14px;line-height:22px;"><strong>Broj ponude:</strong> ${quoteNumber}</p>
        <p style="margin:0;color:#1e40af;font-size:14px;line-height:22px;"><strong>Ukupna vrednost:</strong> ${quoteTotal}</p>
      </div>
      <p style="margin:0 0 12px;color:#1e40af;font-size:14px;line-height:22px;">Za sva dodatna pitanja stojimo Vam na raspolaganju.</p>
      <p style="margin:20px 0 0;color:#b91c1c;font-size:14px;line-height:22px;font-weight:700;">Srdacan pozdrav,<br/>Termo Plast D.O.O</p>
    </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
  setHeader?: (name: string, value: string) => void;
  end?: (body?: string) => void;
};

function readHeader(req: ApiRequest, name: string): string | null {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

function applyCors(req: ApiRequest, res: ApiResponse) {
  if (!res.setHeader) return;
  const origin = readHeader(req, "origin") ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getBearerToken(req: ApiRequest): string | null {
  const header = readHeader(req, "authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function normalizeBase64(value: string): string {
  const trimmed = value.trim();
  const marker = "base64,";
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length).trim();
  }
  return trimmed;
}

async function fetchPdfAsBase64(fileUrl: string): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`PDF nije dostupan na URL-u (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes).toString("base64");
}

async function buildQuotePdfAttachment(input: {
  quoteNumber: string;
  pdfBase64?: string;
  pdfUrl?: string;
  attachmentUrl?: string;
}): Promise<{ filename: string; content: string }> {
  const sourceUrl = input.pdfUrl?.trim() || input.attachmentUrl?.trim() || "";
  let content = input.pdfBase64?.trim() || "";

  if (content.length === 0) {
    if (!sourceUrl) {
      throw new Error("Nedostaje PDF sadržaj: prosledite pdfBase64 ili pdfUrl.");
    }
    content = await fetchPdfAsBase64(sourceUrl);
  } else {
    content = normalizeBase64(content);
  }

  if (!content) {
    throw new Error("PDF prilog nije validan.");
  }

  return {
    filename: `Ponuda-${input.quoteNumber}.pdf`,
    content,
  };
}

function isPayload(input: unknown): input is SendQuotePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const p = input as Record<string, unknown>;
  const totalOk =
    typeof p.quoteTotal === "number" ||
    (typeof p.quoteTotal === "string" && p.quoteTotal.trim().length > 0);
  return (
    typeof p.jobId === "string" &&
    typeof p.customerEmail === "string" &&
    typeof p.customerName === "string" &&
    typeof p.quoteNumber === "string" &&
    totalOk
  );
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    if (res.status) res.status(204);
    if (res.end) {
      res.end();
      return;
    }
    return res.json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    const body = req.body;
    if (!isPayload(body)) {
      return res.status(400).json({ ok: false, error: "Invalid payload." });
    }

    const bearer = getBearerToken(req);
    if (!bearer) {
      return res.status(401).json({ ok: false, error: "Missing bearer token." });
    }

    const supabaseUrl = getEnv("VITE_SUPABASE_URL");
    const anonKey = getEnv("VITE_SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = getEnv("RESEND_API_KEY");
    const resendFrom = process.env.RESEND_FROM_EMAIL || "CRM Stolarija <onboarding@resend.dev>";

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(bearer);
    if (authError || !user) {
      return res.status(401).json({ ok: false, error: "Unauthorized." });
    }

    const attachment = await buildQuotePdfAttachment({
      quoteNumber: body.quoteNumber,
      pdfBase64: body.pdfBase64,
      pdfUrl: body.pdfUrl,
      attachmentUrl: body.attachmentUrl,
    });

    const emailHtml = buildQuoteEmailHtml({
      customerName: body.customerName,
      quoteNumber: body.quoteNumber,
      quoteTotal: String(body.quoteTotal),
    });

    const resend = new Resend(resendApiKey);
    const emailResult = await resend.emails.send({
      from: resendFrom,
      to: [body.customerEmail],
      subject: `Ponuda ${body.quoteNumber}`,
      html: emailHtml,
      attachments: [attachment],
    });

    if (emailResult.error) {
      return res
        .status(502)
        .json({ ok: false, error: emailResult.error.message || "Slanje mejla nije uspelo." });
    }

    const serverSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: updateError } = await serverSupabase
      .from("jobs")
      .update({ status: "quote_sent" })
      .eq("id", body.jobId);

    if (updateError) {
      return res.status(207).json({
        ok: false,
        error: `Mejl je poslat, ali status posla nije azuriran: ${updateError.message}`,
        emailId: emailResult.data?.id ?? null,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Ponuda je uspesno poslata i status posla je azuriran.",
      emailId: emailResult.data?.id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return res.status(500).json({ ok: false, error: message });
  }
}
