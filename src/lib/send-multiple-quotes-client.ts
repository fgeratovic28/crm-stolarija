import { supabase } from "@/lib/supabase";

export type SendMultipleQuotesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  emailId?: string | null;
};

/** Na localhostu uvek isti origin kao Vite (`npm run dev`) — middleware servira /api/quotes/*. */
function resolveSendMultipleEndpoint(): string {
  if (typeof window !== "undefined") {
    const h = window.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") {
      return "/api/quotes/send-multiple";
    }
  }
  const configured = import.meta.env.VITE_QUOTE_SEND_API_URL as string | undefined;
  const endpoint = configured?.trim();
  if (endpoint) {
    try {
      return `${new URL(endpoint).origin}/api/quotes/send-multiple`;
    } catch {
      return "/api/quotes/send-multiple";
    }
  }
  return "/api/quotes/send-multiple";
}

async function readJsonResponse(response: Response): Promise<SendMultipleQuotesApiResponse> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      ok: false,
      error: `Prazan odgovor servera (HTTP ${response.status}). Proverite da je na Vercel-u deploy-ovana funkcija api/quotes/send-multiple.ts ili koristite Vite dev sa učitanim .env (RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY).`,
    };
  }
  try {
    return JSON.parse(raw) as SendMultipleQuotesApiResponse;
  } catch {
    return { ok: false, error: `Neočekivan odgovor (${response.status}).` };
  }
}

export async function sendMultipleQuotesToClient(params: {
  quoteIds: string[];
  jobId: string;
  message?: string;
  includePaymentSlip?: boolean;
  paymentSlipPdfBase64?: string;
  paymentSlipFilename?: string;
}): Promise<SendMultipleQuotesApiResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: "Niste prijavljeni." };
  }

  let response: Response;
  try {
    response = await fetch(resolveSendMultipleEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jobId: params.jobId,
        quoteIds: params.quoteIds,
        message: params.message?.trim() || undefined,
        ...(params.includePaymentSlip === true &&
        params.paymentSlipPdfBase64 &&
        params.paymentSlipFilename?.trim()
          ? {
              includePaymentSlip: true as const,
              paymentSlipPdfBase64: params.paymentSlipPdfBase64.replace(/\s/g, ""),
              paymentSlipFilename: params.paymentSlipFilename.trim(),
            }
          : {}),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Mrežna greška pri pozivu API-ja za slanje ponuda.",
    };
  }

  const result = await readJsonResponse(response);
  if (!response.ok && !result.error) {
    return { ok: false, error: `HTTP ${response.status}` };
  }
  return result;
}
