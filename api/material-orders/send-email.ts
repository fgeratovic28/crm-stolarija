import {
  isSendMaterialOrderEmailPayload,
  runSendMaterialOrderEmailHandler,
} from "../../lib/send-material-order-email-handler.js";
import { parseBearerFromAuthorizationHeader } from "../../lib/bearer-auth.js";

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
    if (!isSendMaterialOrderEmailPayload(body)) {
      return res.status(400).json({ ok: false, error: "Invalid payload." });
    }

    const authHeader = readHeader(req, "authorization") ?? undefined;
    const bearer = parseBearerFromAuthorizationHeader(authHeader ?? undefined);
    if (!bearer) {
      return res.status(401).json({ ok: false, error: "Missing bearer token." });
    }

    const result = await runSendMaterialOrderEmailHandler(body, bearer);
    return res.status(result.status).json(result.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return res.status(500).json({ ok: false, error: message });
  }
}
