import { readEnv } from "./read-env.js";
import { runInboundEmailWebhook } from "./inbound-email-webhook-core.js";

export async function handleInboundEmailWebhook(params: {
  rawBody: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const webhookSecret = readEnv("RESEND_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("Missing RESEND_WEBHOOK_SECRET env variable");
    return { status: 500, body: { ok: false, error: "Webhook secret not configured." } };
  }

  const resendApiKey = readEnv("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("Missing RESEND_API_KEY env variable");
    return { status: 500, body: { ok: false, error: "Resend API key not configured." } };
  }

  const forwardTo = readEnv("EMAIL_FORWARD_TO") || "fgeratovic03@gmail.com";
  const forwardFrom = readEnv("FORWARD_FROM_EMAIL") || "ponude@crmtermoplast.online";

  return runInboundEmailWebhook(params, {
    resendApiKey,
    webhookSecret,
    forwardTo,
    forwardFrom,
  });
}
