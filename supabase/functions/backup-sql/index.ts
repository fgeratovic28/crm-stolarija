import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.735.0";

const BACKUP_TABLES = [
  "customers",
  "jobs",
  "material_orders",
  "job_items",
  "quotes",
  "quote_lines",
  "activities",
  "work_orders",
  "field_reports",
  "payments",
] as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer",
  "Access-Control-Max-Age": "86400",
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && role.toLowerCase() === "admin";
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tableToSql(tableName: string, rows: JsonRecord[]): string {
  if (rows.length === 0) return `-- ${tableName}: no rows`;
  const payload = sqlQuote(JSON.stringify(rows));
  return `INSERT INTO public.${tableName} SELECT * FROM json_populate_recordset(NULL::public.${tableName}, ${payload}::json);`;
}

async function fetchAllRows(supabase: any, tableName: string): Promise<JsonRecord[]> {
  const pageSize = 1000;
  const output: JsonRecord[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(tableName).select("*").range(from, to);
    if (error) throw new Error(`Fetch failed for ${tableName}: ${error.message}`);
    const rows = (data ?? []) as JsonRecord[];
    output.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return output;
}

function buildR2Client() {
  const accountId = getEnv("R2_ACCOUNT_ID");
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function backupFileKey(now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `backups/termoplast_backup_${yyyy}-${mm}-${dd}_${hh}-${min}.sql`;
}

async function ensureAuthorized(req: Request): Promise<boolean> {
  const token = getBearerToken(req);
  if (!token) return false;

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret && token === cronSecret) return true;

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) return false;

  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (userErr || !isAdminRole(userRow?.role)) return false;

  return true;
}

async function runBackup() {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const parts: string[] = [];
  let totalRows = 0;
  parts.push("-- Termo Plast CRM SQL backup");
  parts.push(`-- Generated at UTC: ${new Date().toISOString()}`);
  parts.push("BEGIN;");

  for (const tableName of BACKUP_TABLES) {
    const rows = await fetchAllRows(supabase, tableName);
    totalRows += rows.length;
    parts.push(`\n-- Table: ${tableName} (rows: ${rows.length})`);
    parts.push(tableToSql(tableName, rows));
  }

  parts.push("\nCOMMIT;");
  const sqlText = `${parts.join("\n")}\n`;

  const bucketName = getEnv("R2_BUCKET_NAME");
  const key = backupFileKey(new Date());
  const client = buildR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: sqlText,
      ContentType: "application/sql; charset=utf-8",
    }),
  );

  return { key, totalRows, tableCount: BACKUP_TABLES.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const authorized = await ensureAuthorized(req);
    if (!authorized) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const result = await runBackup();
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
