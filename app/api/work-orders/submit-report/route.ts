import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  processWorkOrderReport,
  type WorkOrderReportPayload,
} from "@/lib/services/report-processor";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function isPayload(input: unknown): input is WorkOrderReportPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const p = input as Record<string, unknown>;
  return (
    typeof p.workOrderId === "string" &&
    typeof p.jobId === "string" &&
    typeof p.workOrderType === "string" &&
    typeof p.completionStatus === "string" &&
    typeof p.issuesFound === "boolean" &&
    typeof p.reportNotes === "string"
  );
}

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isPayload(body)) {
      return NextResponse.json(
        { error: "Invalid payload." },
        { status: 400 },
      );
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const bearer = getBearerToken(req);

    if (!bearer) {
      return NextResponse.json({ error: "Missing bearer token." }, { status: 401 });
    }

    // Auth verification (request-scoped user identity).
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(bearer);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // Privileged server client for coordinated updates.
    const serverSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const result = await processWorkOrderReport(serverSupabase, body, user.id);

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
