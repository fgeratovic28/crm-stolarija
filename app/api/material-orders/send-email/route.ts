import { NextResponse, type NextRequest } from "next/server";
import {
  isSendMaterialOrderEmailPayload,
  runSendMaterialOrderEmailHandler,
} from "../../../../lib/send-material-order-email-handler";
import { parseBearerFromAuthorizationHeader } from "../../../../lib/bearer-auth.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isSendMaterialOrderEmailPayload(body)) {
      return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
    }

    const bearer = parseBearerFromAuthorizationHeader(req.headers.get("authorization") ?? undefined);
    if (!bearer) {
      return NextResponse.json({ ok: false, error: "Missing bearer token." }, { status: 401 });
    }

    const result = await runSendMaterialOrderEmailHandler(body, bearer);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
