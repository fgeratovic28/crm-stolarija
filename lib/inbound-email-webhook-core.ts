import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import type { EmailReceivedEvent } from "resend";

export type InboundEmailWebhookConfig = {
  resendApiKey: string;
  webhookSecret: string;
  forwardTo: string;
  forwardFrom: string;
};

export async function runInboundEmailWebhook(
  params: {
    rawBody: string;
    svixId: string;
    svixTimestamp: string;
    svixSignature: string;
  },
  config: InboundEmailWebhookConfig,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resend = new Resend(config.resendApiKey);

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    Object.entries(process.env).find(([k]) => k.trim() === "SUPABASE_SERVICE_ROLE_KEY")?.[1]?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase env variables");
    return { status: 500, body: { ok: false, error: "Database not configured." } };
  }

  let event: EmailReceivedEvent;
  try {
    const verified = resend.webhooks.verify({
      payload: params.rawBody,
      headers: {
        id: params.svixId,
        timestamp: params.svixTimestamp,
        signature: params.svixSignature,
      } as unknown as Headers,
      webhookSecret: config.webhookSecret,
    });
    if (verified.type !== "email.received") {
      return { status: 200, body: { ok: true, ignored: `event type: ${verified.type}` } };
    }
    event = verified as EmailReceivedEvent;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Webhook verification failed:", msg);
    return { status: 401, body: { ok: false, error: "Invalid webhook signature." } };
  }

  const { email_id, from, to, subject, message_id } = event.data;

  console.log(`Processing inbound email ${email_id} from ${from}`);

  const serverSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const forwardResult = await resend.emails.receiving.forward({
      emailId: email_id,
      to: config.forwardTo,
      from: config.forwardFrom,
      passthrough: true,
    });

    if (forwardResult.error) {
      throw new Error(`Resend forward error: ${forwardResult.error.message}`);
    }

    const forwardId = forwardResult.data?.id ?? null;

    const { error: dbErr } = await serverSupabase.from("inbound_email_logs").insert([
      {
        email_id,
        from,
        to,
        subject,
        message_id: message_id ?? null,
        forwarded_to: config.forwardTo,
        forwarded_at: new Date().toISOString(),
        status: "forwarded",
        error_message: null,
      },
    ]);
    if (dbErr) {
      console.error("Failed to log inbound email to DB:", dbErr.message);
    }

    console.log(`Forwarded inbound email ${email_id} -> ${config.forwardTo}, forwardId=${forwardId}`);

    return {
      status: 200,
      body: { ok: true, email_id, forward_id: forwardId },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to forward inbound email ${email_id}:`, msg);

    const { error: dbErr } = await serverSupabase.from("inbound_email_logs").insert([
      {
        email_id,
        from,
        to,
        subject,
        message_id: message_id ?? null,
        forwarded_to: config.forwardTo,
        forwarded_at: new Date().toISOString(),
        status: "failed",
        error_message: msg,
      },
    ]);
    if (dbErr) {
      console.error("Failed to log failed inbound email to DB:", dbErr.message);
    }

    return { status: 502, body: { ok: false, error: msg, email_id } };
  }
}
