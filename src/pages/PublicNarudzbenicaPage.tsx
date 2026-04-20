import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { buildNarudzbenicaHtmlFromParts, narudzbenicaPartsFromPublicRpc } from "@/lib/narudzbenica-html";
import { supabase } from "@/lib/supabase";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export default function PublicNarudzbenicaPage() {
  const { token } = useParams<{ token: string }>();

  const { data: html, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["public-narudzbenica", token],
    queryFn: async () => {
      if (!token || !isUuid(token)) {
        throw new Error("Neispravan link.");
      }
      const { data, error: rpcError } = await supabase.rpc("get_public_narudzbenica", { p_token: token });
      if (rpcError) throw rpcError;
      if (data == null || (typeof data === "object" && data !== null && Object.keys(data).length === 0)) {
        throw new Error("Narudžbenica nije pronađena ili link više nije važeći.");
      }
      const parts = narudzbenicaPartsFromPublicRpc(data as Record<string, unknown>);
      return buildNarudzbenicaHtmlFromParts(parts);
    },
    enabled: !!token && isUuid(token ?? ""),
    retry: false,
  });

  const handlePrint = () => {
    if (!html) return;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  };

  if (!token || !isUuid(token)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground">Neispravan link za narudžbenicu.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6">
        <p className="text-muted-foreground">Učitavanje narudžbenice…</p>
      </div>
    );
  }

  if (isError || !html) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center max-w-md mx-auto">
        <p className="text-destructive font-medium">{error instanceof Error ? error.message : "Greška pri učitavanju."}</p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>
          Pokušaj ponovo
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="sticky top-0 z-10 flex items-center justify-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="button" size="sm" onClick={handlePrint}>
          <Printer className="w-4 h-4 mr-2" />
          Štampaj / PDF
        </Button>
        <span className="text-xs text-muted-foreground hidden sm:inline">Javni pregled narudžbenice (bez prijave u CRM)</span>
      </div>
      <iframe title="Narudžbenica" className="w-full min-h-[calc(100vh-52px)] border-0 bg-white" srcDoc={html} />
    </div>
  );
}
