import type { IncomingMessage, ServerResponse } from "node:http";
import { handleInboundEmailWebhook } from "../../lib/inbound-email-handler.js";

type VercelRes = ServerResponse & {
  status?: (code: number) => { json: (payload: unknown) => void };
  json?: (payload: unknown) => void;
};

function jsonResponse(res: VercelRes, statusCode: number, payload: Record<string, unknown>) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(statusCode).json(payload);
  } else {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  }
}

function readHeader(
  req: IncomingMessage & { body?: unknown },
  name: string,
): string | null {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" ? raw : null;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: VercelRes,
) {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    let rawBody = "";
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
      }
      rawBody = Buffer.concat(chunks).toString("utf8");
    } catch {
      /* stream may have been consumed by Vercel body parser */
    }
    if (!rawBody && req.body) {
      rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }

    const svixId = readHeader(req, "svix-id") ?? "";
    const svixTimestamp = readHeader(req, "svix-timestamp") ?? "";
    const svixSignature = readHeader(req, "svix-signature") ?? "";

    const result = await handleInboundEmailWebhook({
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
    });

    jsonResponse(res, result.status, result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error("Inbound email webhook error:", message);
    jsonResponse(res, 500, { ok: false, error: message });
  }
}
