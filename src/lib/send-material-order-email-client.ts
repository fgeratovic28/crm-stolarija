import { supabase } from "@/lib/supabase";

export type SendMaterialOrderEmailApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  emailId?: string | null;
  recipient?: string;
};

function resolveSendMaterialOrderEmailEndpoint(): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") {
      return "/api/material-orders/send-email";
    }
  }
  const configured = import.meta.env.VITE_PROCUREMENT_EMAIL_API_URL as string | undefined;
  const endpoint = configured?.trim();
  if (endpoint) {
    try {
      return `${new URL(endpoint).origin}/api/material-orders/send-email`;
    } catch {
      return "/api/material-orders/send-email";
    }
  }
  return "/api/material-orders/send-email";
}

async function readJsonResponse(response: Response): Promise<SendMaterialOrderEmailApiResponse> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      ok: false,
      error: `Prazan odgovor servera (HTTP ${response.status}). Proverite RESEND_PROCUREMENT_API_KEY i SUPABASE_SERVICE_ROLE_KEY u .env.`,
    };
  }
  try {
    return JSON.parse(raw) as SendMaterialOrderEmailApiResponse;
  } catch {
    const looksLikeHtml = /^\s*</i.test(raw) || raw.includes("<!DOCTYPE");
    if (looksLikeHtml) {
      return {
        ok: false,
        error:
          `API ruta nije dostupna (HTTP ${response.status}) — server vraća HTML umesto JSON-a. ` +
          "Na Vercelu redeployujte posle izmene vercel.json; lokalno koristite npm run dev.",
      };
    }
    return { ok: false, error: `Neočekivan odgovor (${response.status}).` };
  }
}

export async function sendMaterialOrderEmailToSupplier(params: {
  orderId: string;
  subject: string;
  message: string;
  signature: string;
}): Promise<SendMaterialOrderEmailApiResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Niste prijavljeni." };
  }

  let response: Response;
  try {
    response = await fetch(resolveSendMaterialOrderEmailEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        orderId: params.orderId,
        subject: params.subject.trim(),
        message: params.message,
        signature: params.signature.trim(),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Mrežna greška pri slanju mejla dobavljaču.",
    };
  }

  const result = await readJsonResponse(response);
  if (!response.ok && !result.error) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  return result;
}
