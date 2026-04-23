import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type SendQuoteButtonProps = {
  jobId: string;
  customerEmail?: string;
  customerName?: string;
  quoteNumber: string;
  quoteTotal: number;
  pdfUrl?: string;
  onSuccess?: () => Promise<void> | void;
};

type SendQuoteApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

function resolveQuoteSendEndpoint(): string {
  const configured = import.meta.env.VITE_QUOTE_SEND_API_URL as string | undefined;
  const endpoint = configured?.trim();
  if (endpoint) return endpoint;
  return "/api/quotes/send";
}

async function readSendQuoteResponse(response: Response): Promise<SendQuoteApiResponse> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      ok: false,
      error:
        "API endpoint za slanje ponuda nije dostupan. Proverite VITE_QUOTE_SEND_API_URL ili deployment backend-a.",
    };
  }
  try {
    return JSON.parse(raw) as SendQuoteApiResponse;
  } catch {
    return {
      ok: false,
      error: `Neocekivan odgovor servera (${response.status}).`,
    };
  }
}

export function SendQuoteButton(props: SendQuoteButtonProps) {
  const [isSending, setIsSending] = useState(false);

  const canSend = Boolean(props.customerEmail && props.customerName && props.pdfUrl);

  const handleSend = async () => {
    if (!props.customerEmail || !props.customerName) {
      toast.error("Kupac nema unet mejl ili ime.");
      return;
    }
    if (!props.pdfUrl) {
      toast.error("Ponuda nema PDF prilog za slanje.");
      return;
    }

    setIsSending(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Niste prijavljeni. Osvežite stranicu i pokušajte ponovo.");
      }

      const response = await fetch(resolveQuoteSendEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          jobId: props.jobId,
          customerEmail: props.customerEmail,
          customerName: props.customerName,
          quoteNumber: props.quoteNumber,
          quoteTotal: props.quoteTotal,
          pdfUrl: props.pdfUrl,
        }),
      });

      const result = await readSendQuoteResponse(response);
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Slanje ponude nije uspelo.");
      }

      await props.onSuccess?.();
      toast.success("Ponuda uspešno poslata");
    } catch (error) {
      toast.error("Greška pri slanju ponude", {
        description: error instanceof Error ? error.message : "Nepoznata greška.",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={!canSend || isSending} onClick={() => void handleSend()}>
      {isSending ? (
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <Mail className="w-4 h-4 mr-1" />
      )}
      Pošalji ponudu klijentu
    </Button>
  );
}
