import {
  fetchImageBytesFromUpstream,
  isProxyableR2ImageUrl,
  pickR2PublicBaseUrl,
} from "../lib/image-proxy-for-r2.js";

type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => unknown;
  setHeader?: (name: string, value: string | number) => void;
  end?: (body?: string | Uint8Array | Buffer) => void;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function readTargetUrl(req: ApiRequest): string | null {
  const rawUrl = typeof req.url === "string" ? req.url : "";
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, "http://local");
    const target = u.searchParams.get("u");
    return target && target.trim() ? target.trim() : null;
  } catch {
    return null;
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.status?.(204);
    res.end?.();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const targetUrl = readTargetUrl(req);
  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: "Missing u query parameter." });
  }

  const r2base = pickR2PublicBaseUrl(process.env as Record<string, string | undefined>);
  if (!isProxyableR2ImageUrl(targetUrl, r2base)) {
    return res.status(403).json({ ok: false, error: "URL not allowed for proxy." });
  }

  try {
    const fetched = await fetchImageBytesFromUpstream(targetUrl);
    if (!fetched) {
      return res.status(502).json({ ok: false, error: "Could not fetch image." });
    }
    res.status?.(200);
    res.setHeader?.("Content-Type", fetched.contentType);
    res.setHeader?.("Cache-Control", "private, max-age=300");
    const nodeBuf = Buffer.from(fetched.bytes);
    res.end?.(nodeBuf);
    return;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error.";
    return res.status(500).json({ ok: false, error: message });
  }
}
