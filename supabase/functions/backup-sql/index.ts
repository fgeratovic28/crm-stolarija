import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.735.0";

/** Fallback ako RPC migracija još nije primenjena na projektu. */
const BACKUP_TABLES_FALLBACK = [
  "activities",
  "app_settings",
  "customers",
  "field_reports",
  "files",
  "inbound_email_logs",
  "invoice_missing_part_secured",
  "invoice_missing_site_procurement",
  "job_items",
  "job_number_counters",
  "jobs",
  "material_item_code_memory",
  "material_orders",
  "montaze",
  "payments",
  "procurement_ad_hoc_items",
  "procurement_complaints",
  "quotes",
  "sales_alert_notes",
  "sales_site_addon_quote_alerts",
  "suppliers",
  "teams",
  "user_notifications",
  "users",
  "vehicles",
  "work_order_items",
  "work_orders",
  "worker_sick_leaves",
  "workers",
] as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-api-version, prefer, x-cron-secret",
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

function isMissingTableError(message: string): boolean {
  return /could not find the table/i.test(message) || /does not exist/i.test(message);
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

async function resolveBackupTables(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.rpc("backup_list_public_tables");
  if (!error && Array.isArray(data) && data.length > 0) {
    const names = data
      .map((row: { tablename?: string } | string) =>
        typeof row === "string" ? row : (row.tablename ?? ""),
      )
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    if (names.length > 0) return names;
  }

  return [...BACKUP_TABLES_FALLBACK];
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
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (cronSecret) {
    const headerSecret = req.headers.get("x-cron-secret")?.trim();
    if (headerSecret && headerSecret === cronSecret) return true;

    const token = getBearerToken(req);
    if (token && token === cronSecret) return true;
  }

  const token = getBearerToken(req);
  if (!token) return false;

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

  const tableNames = await resolveBackupTables(supabase);
  const parts: string[] = [];
  let totalRows = 0;
  const skippedTables: string[] = [];

  parts.push("-- Termo Plast CRM SQL backup");
  parts.push(`-- Generated at UTC: ${new Date().toISOString()}`);
  parts.push(`-- Tables: ${tableNames.length}`);
  parts.push("BEGIN;");

  for (const tableName of tableNames) {
    try {
      const rows = await fetchAllRows(supabase, tableName);
      totalRows += rows.length;
      parts.push(`\n-- Table: ${tableName} (rows: ${rows.length})`);
      parts.push(tableToSql(tableName, rows));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMissingTableError(message)) {
        skippedTables.push(tableName);
        parts.push(`\n-- Table: ${tableName} (skipped: not in schema)`);
        continue;
      }
      throw error;
    }
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

  return {
    key,
    totalRows,
    tableCount: tableNames.length,
    skippedTables,
  };
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
