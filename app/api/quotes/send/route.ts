import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { QuoteEmail } from "../../../../components/emails/QuoteEmail";
import { buildQuotePdfAttachment } from "../../../../lib/quote-email-attachment";

export const runtime = "nodejs";

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

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isPayload(body)) {
      return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
    }

    const bearer = getBearerToken(req);
    if (!bearer) {
      return NextResponse.json({ ok: false, error: "Missing bearer token." }, { status: 401 });
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
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
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const attachment = await buildQuotePdfAttachment({
      quoteNumber: body.quoteNumber,
      pdfBase64: body.pdfBase64,
      pdfUrl: body.pdfUrl,
      attachmentUrl: body.attachmentUrl,
    });

    const emailHtml = await render(
      QuoteEmail({
        customerName: body.customerName,
        quoteNumber: body.quoteNumber,
        quoteTotal: String(body.quoteTotal),
      }),
    );

    const resend = new Resend(resendApiKey);
    const emailResult = await resend.emails.send({
      from: resendFrom,
      to: [body.customerEmail],
      subject: `Ponuda ${body.quoteNumber}`,
      html: emailHtml,
      attachments: [attachment],
    });

    if (emailResult.error) {
      return NextResponse.json(
        { ok: false, error: emailResult.error.message || "Slanje mejla nije uspelo." },
        { status: 502 },
      );
    }

    const serverSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: updateError } = await serverSupabase
      .from("jobs")
      .update({ status: "quote_sent" })
      .eq("id", body.jobId);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Mejl je poslat, ali status posla nije ažuriran: ${updateError.message}`,
          emailId: emailResult.data?.id ?? null,
        },
        { status: 207 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        message: "Ponuda je uspešno poslata i status posla je ažuriran.",
        emailId: emailResult.data?.id ?? null,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
