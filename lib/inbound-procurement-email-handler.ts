import { readEnv } from "./read-env.js";
import { runInboundEmailWebhook } from "./inbound-email-webhook-core.js";

function procurementForwardTo(): string {
  return (
    readEnv("PROCUREMENT_EMAIL_FORWARD_TO") ||
    readEnv("RESEND_PROCUREMENT_REPLY_TO") ||
    "fgeratovic03@gmail.com"
  );
}

function procurementForwardFrom(): string {
  const raw = readEnv("PROCUREMENT_FORWARD_FROM_EMAIL");
  if (raw) {
    if (raw.includes("<") && raw.includes(">")) return raw;
    return `Termo Plast Nabavka <${raw}>`;
  }
  return "ivan@nabavka.crmtermoplast.online";
}

export async function handleInboundProcurementEmailWebhook(params: {
  rawBody: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const webhookSecret = readEnv("RESEND_PROCUREMENT_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("Missing RESEND_PROCUREMENT_WEBHOOK_SECRET env variable");
    return { status: 500, body: { ok: false, error: "Procurement webhook secret not configured." } };
  }

  const resendApiKey = readEnv("RESEND_PROCUREMENT_API_KEY");
  if (!resendApiKey) {
    console.error("Missing RESEND_PROCUREMENT_API_KEY env variable");
    return { status: 500, body: { ok: false, error: "Procurement Resend API key not configured." } };
  }

  return runInboundEmailWebhook(params, {
    resendApiKey,
    webhookSecret,
    forwardTo: procurementForwardTo(),
    forwardFrom: procurementForwardFrom(),
  });
}
