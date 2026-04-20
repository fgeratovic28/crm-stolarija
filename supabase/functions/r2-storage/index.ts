import { S3Client, PutObjectCommand, DeleteObjectCommand } from "npm:@aws-sdk/client-s3@3.735.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.735.0";

const ALLOWED_PREFIXES = ["files/", "field-photos/"] as const;

/** CORS: bez ovoga browser (npr. Safari) šalje OPTIONS preflight i dobija 405 → blokira POST. */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Max-Age": "86400",
};

type Body =
  | { op: "presign-put"; key: string; contentType?: string }
  | { op: "delete"; key: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function assertAllowedKey(key: string): void {
  const k = typeof key === "string" ? key.trim() : "";
  if (!k || k.includes("..") || k.startsWith("/")) {
    throw new Error("Invalid object key");
  }
  if (!ALLOWED_PREFIXES.some((p) => k.startsWith(p))) {
    throw new Error("Object key prefix not allowed");
  }
}

function createS3(): S3Client {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")?.trim();
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not configured on the server");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Bez ovoga SDK dodaje CRC32 u presigned URL; browser PUT bez SDK → R2 400.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function getBucket(): string {
  const bucket = Deno.env.get("R2_BUCKET_NAME");
  if (!bucket?.trim()) {
    throw new Error("R2_BUCKET_NAME is not set");
  }
  return bucket.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let parsed: Body;
  try {
    parsed = (await req.json()) as Body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  try {
    const op = parsed?.op;
    const client = createS3();
    const bucket = getBucket();

    if (op === "presign-put") {
      const key = parsed.key;
      const contentType = (parsed.contentType || "application/octet-stream").trim() || "application/octet-stream";
      assertAllowedKey(key);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
      return jsonResponse({ key, uploadUrl });
    }

    if (op === "delete") {
      const key = parsed.key;
      assertAllowedKey(key);
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      return jsonResponse({ ok: true, key });
    }

    return jsonResponse({ error: "Unknown op" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 400);
  }
});
