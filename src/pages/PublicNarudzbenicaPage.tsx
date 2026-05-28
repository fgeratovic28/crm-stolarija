import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Printer } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { linesFromPublicRpcRow } from "@/lib/material-order-lines";
import { generateProcurementOrderPdfBlob } from "@/lib/material-order-procurement-pdf";
import { buildOrderReceptionAbsoluteUrl } from "@/lib/order-reception-url";
import { procurementPdfRowsFromOrderLines } from "@/lib/material-order-procurement-rows";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useRole } from "@/contexts/RoleContext";
import { useMaterialOrderAttachments } from "@/hooks/use-material-order-files";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export default function PublicNarudzbenicaPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, authReady, authProfileReady } = useAuthStore();
  const { hasAccess } = useRole();

  const {
    data: publicSnapshotData,
    isLoading: publicSnapshotLoading,
    refetch: refetchPublicSnapshot,
    error: publicSnapshotError,
  } = useQuery({
    queryKey: ["public-narudzbenica", token],
    queryFn: async () => {
      if (!token || !isUuid(token)) {
        throw new Error("Neispravan link.");
      }
      const { data, error: rpcError } = await supabase.rpc("get_public_narudzbenica", { p_token: token });
      if (rpcError) throw rpcError;
      if (data == null || (typeof data === "object" && data !== null && Object.keys(data as object).length === 0)) {
        throw new Error("Narudžbenica nije pronađena ili link više nije važeći.");
      }
      return data as Record<string, unknown>;
    },
    enabled: !!token && isUuid(token ?? ""),
    retry: false,
  });

  const materialOrderId = publicSnapshotData?.id as string | undefined;
  const { data: attachmentsByOrder, isLoading: attachmentsLoading } = useMaterialOrderAttachments(
    materialOrderId ? [materialOrderId] : []
  );

  const existingPdfAttachment = attachmentsByOrder?.[materialOrderId || ""]?.find(
    (file) => file.name.toLowerCase().endsWith(".pdf")
  );

  const {
    data: generatedPdfUrl,
    isLoading: generatingPdf,
    isError: generatePdfError,
    error: generatePdfErrorData,
    refetch: refetchGeneratePdf,
  } = useQuery({
    queryKey: ["public-narudzbenica-pdf", token],
    queryFn: async () => {
      if (!token || !isUuid(token) || !publicSnapshotData) {
        throw new Error("Neispravan link.");
      }
      const row = publicSnapshotData;
      const lines = linesFromPublicRpcRow(row);
      const rows = procurementPdfRowsFromOrderLines(lines);
      if (!rows) {
        throw new Error(
          "Ova narudžbina nema uvezene stavke iz Excela potrebne za PDF. Otvorite je u CRM-u i ponovo ubacite stavke iz Excela.",
        );
      }
      const shareToken = String(row.publicShareToken ?? token);
      const blob = await generateProcurementOrderPdfBlob({
        rows,
        nalogLabel: String(row.jobNumber ?? "—").trim() || "—",
        crmUrl: buildOrderReceptionAbsoluteUrl(String(row.id ?? "")),
        footerNote: row.notes != null ? String(row.notes).trim() : "",
        barcodeScope: { materialOrderId: String(row.id ?? "") },
      });
      return URL.createObjectURL(blob);
    },
    enabled: !!token && isUuid(token ?? "") && !!publicSnapshotData && !existingPdfAttachment,
    retry: false,
  });

  useEffect(() => {
    if (!generatedPdfUrl) return;
    return () => URL.revokeObjectURL(generatedPdfUrl);
  }, [generatedPdfUrl]);

  useEffect(() => {
    if (
      authReady &&
      isAuthenticated &&
      authProfileReady &&
      (hasAccess("material-orders") || hasAccess("material-reception")) &&
      publicSnapshotData?.id
    ) {
      navigate(`/order-reception/${publicSnapshotData.id}`, { replace: true });
    }
  }, [authReady, isAuthenticated, authProfileReady, hasAccess, publicSnapshotData?.id, navigate]);

  const handleOpenPrint = () => {
    const url = existingPdfAttachment?.storageUrl || generatedPdfUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const pdfUrl = existingPdfAttachment?.storageUrl || generatedPdfUrl;
  const isLoading = publicSnapshotLoading || attachmentsLoading || generatingPdf;
  const isError = !!publicSnapshotError || !!generatePdfError;
  const error = publicSnapshotError || generatePdfErrorData;

  if (!token || !isUuid(token)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <p className="text-muted-foreground">Neispravan link za narudžbenicu.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">Učitavanje porudžbine…</p>
      </div>
    );
  }

  if (isError || !pdfUrl) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center max-w-md mx-auto">
        <p className="text-destructive font-medium">{error instanceof Error ? error.message : "Greška pri učitavanju."}</p>
        <Button type="button" variant="outline" onClick={() => {
          if (publicSnapshotError) refetchPublicSnapshot();
          if (generatePdfError) refetchGeneratePdf();
        }}>
          Pokušaj ponovo
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur sm:gap-3">
        <Button type="button" size="sm" onClick={handleOpenPrint}>
          <Printer className="w-4 h-4 mr-2" />
          Otvori / štampaj PDF
        </Button>
        <Button type="button" size="sm" variant="outline" asChild>
          <a href={pdfUrl} download={`porudzbina-javni-${token.slice(0, 8)}.pdf`} className="inline-flex items-center">
            <ExternalLink className="w-4 h-4 mr-2" />
            Preuzmi
          </a>
        </Button>
        <span className="text-xs text-muted-foreground hidden sm:inline w-full text-center sm:w-auto sm:text-left">
          Javni pregled porudžbine (bez prijave u CRM)
        </span>
      </div>
      <iframe title="Porudžbina PDF" className="w-full min-h-[calc(100vh-52px)] border-0 bg-white" src={pdfUrl} />
    </div>
  );
}
