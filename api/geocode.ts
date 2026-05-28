import { geocodeAddressOnServer } from "../lib/geocode-address-server.js";

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

function readQuery(req: ApiRequest): string | null {
  const rawUrl = typeof req.url === "string" ? req.url : "";
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl, "http://local");
    const q = u.searchParams.get("q")?.trim();
    return q || null;
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

  const q = readQuery(req);
  if (!q) {
    return res.status(400).json({ ok: false, error: "Missing q query parameter." });
  }
  if (q.length > 500) {
    return res.status(400).json({ ok: false, error: "Query too long." });
  }

  try {
    const coords = await geocodeAddressOnServer(q);
    if (!coords) {
      return res.status(404).json({ ok: false, error: "Address not found." });
    }
    res.setHeader?.("Cache-Control", "public, max-age=86400");
    return res.status(200).json({ ok: true, lat: coords.lat, lng: coords.lng });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error.";
    return res.status(500).json({ ok: false, error: message });
  }
}
