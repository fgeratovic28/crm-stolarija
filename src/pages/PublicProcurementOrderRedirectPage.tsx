import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

type RedirectPayload = {
  order_id: string;
  kind: "adhoc" | "complaint" | string;
  supplier: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
};

/**
 * QR sa PDF-a (reklamacije / vanredne stavke) vodi ovde.
 *  - Prijavljen CRM korisnik: direktno na `/order-reception/<order_id>` (skener prijema).
 *  - Spoljni posetilac (ad-hoc): preusmerenje na prvi prilog pending vanredne stavke u toj porudžbini.
 *  - Spoljni posetilac (complaint): poruka „Prijavite se u CRM" (reklamacije nemaju javni fajl).
 */
export default function PublicProcurementOrderRedirectPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const kindRaw = (searchParams.get("kind") ?? "adhoc").toLowerCase();
  const kind = useMemo<"adhoc" | "complaint">(
    () => (kindRaw === "complaint" ? "complaint" : "adhoc"),
    [kindRaw],
  );
  const resolvedOrderId = useMemo(() => orderId?.trim() ?? "", [orderId]);
  const { isAuthenticated, authReady } = useAuthStore();

  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RedirectPayload | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(true);

  useEffect(() => {
    if (!resolvedOrderId) {
      setError("Nevažeći link.");
      setLoadingPayload(false);
      return;
    }
    let canceled = false;
    void (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "get_procurement_order_public_redirect",
          { p_order_id: resolvedOrderId, p_kind: kind },
        );
        if (canceled) return;
        if (rpcError) throw rpcError;
        const obj = (data ?? null) as RedirectPayload | null;
        if (!obj || !obj.order_id) {
          setError("Porudžbina nije pronađena.");
          return;
        }
        setPayload(obj);
      } catch (e) {
        if (canceled) return;
        setError(e instanceof Error ? e.message : "Greška pri učitavanju porudžbine.");
      } finally {
        if (!canceled) setLoadingPayload(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [resolvedOrderId, kind]);

  if (!authReady || loadingPayload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Otvaram link…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <p className="font-semibold">Link nije validan</p>
          <p className="mt-1 text-destructive/80">{error}</p>
        </div>
      </div>
    );
  }

  if (isAuthenticated && payload?.order_id) {
    return <Navigate to={`/order-reception/${payload.order_id}`} replace />;
  }

  if (payload?.attachment_url) {
    if (typeof window !== "undefined") {
      window.location.replace(payload.attachment_url);
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <a
          href={payload.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-medium text-primary shadow-sm hover:bg-muted"
        >
          <ExternalLink className="h-4 w-4" />
          {payload.attachment_name ?? "Otvori fajl"}
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-6 text-sm">
        <p className="font-semibold text-foreground">
          {kind === "complaint" ? "Reklamacija porudžbine" : "Porudžbina"}
        </p>
        <p className="mt-1 text-muted-foreground">
          Otvaranje detalja zahteva prijavu u CRM. {payload?.supplier ? `Dobavljač: ${payload.supplier}.` : null}
        </p>
      </div>
    </div>
  );
}
