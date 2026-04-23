import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, Loader2, PlusCircle, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { formatCurrencyBySettings, formatDateByAppLanguage } from "@/lib/app-settings";
import { labelQuoteStatus } from "@/lib/activity-labels";
import { useQuotes } from "@/hooks/use-quotes";
import { sumQuoteLineAmounts } from "@/hooks/use-jobs";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { exportQuotePDF } from "@/lib/export-documents";
import type { JobQuoteLine, Quote, QuoteStatus } from "@/types";
import { SendQuoteButton } from "@/components/job-tabs/SendQuoteButton";

function amountInputString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

const STATUS_VARIANT: Record<QuoteStatus, "muted" | "info" | "success" | "danger"> = {
  draft: "muted",
  sent: "info",
  accepted: "success",
  rejected: "danger",
};

export function QuotesTab({
  jobId,
  quotes: initialQuotes,
  customerEmail,
  customerName,
  jobQuoteLines,
  suggestedQuoteTotal,
  defaultPricesIncludeVat = true,
  createDialogOpen,
  onCreateDialogOpenChange,
  createMode = "standard",
}: {
  jobId: string;
  quotes?: Quote[];
  customerEmail?: string;
  customerName?: string;
  /** Stavke sa posla (unos pri „Novi posao“) — popunjavaju formu „Nova ponuda“. */
  jobQuoteLines?: JobQuoteLine[];
  /** Ukupna cena posla (npr. sa PDV-om); ako nije setovano, koristi se zbir stavki. */
  suggestedQuoteTotal?: number;
  defaultPricesIncludeVat?: boolean;
  createDialogOpen?: boolean;
  onCreateDialogOpenChange?: (open: boolean) => void;
  createMode?: "standard" | "final";
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { quotes: fetchedQuotes, createQuote, updateQuoteStatus, isLoading } = useQuotes(jobId);
  const quotes = initialQuotes ?? fetchedQuotes;
  const sortedQuotes = useMemo(
    () =>
      [...quotes].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [quotes],
  );

  const [open, setOpen] = useState(false);
  const dialogOpen = createDialogOpen ?? open;
  const [note, setNote] = useState("");
  const [isFinalOffer, setIsFinalOffer] = useState(createMode === "final");
  const [pricesIncludeVat, setPricesIncludeVat] = useState(defaultPricesIncludeVat);
  const [pdfFile, setPdfFile] = useState<File | undefined>();
  const [lines, setLines] = useState([{ description: "", quantity: "1", unitPrice: "0" }]);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setNote("");
    setIsFinalOffer(createMode === "final");
    setPricesIncludeVat(defaultPricesIncludeVat);
    setPdfFile(undefined);
    setLines([{ description: "", quantity: "1", unitPrice: "0" }]);
  }, [createMode, defaultPricesIncludeVat]);

  const seedFormFromJob = useCallback(() => {
    const linesSource = jobQuoteLines?.filter((l) => l.description?.trim()) ?? [];
    if (linesSource.length === 0) {
      resetForm();
      return;
    }
    const sorted = [...linesSource].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    setLines(
      sorted.map((l) => ({
        description: l.description.trim(),
        quantity: String(Number.isFinite(l.quantity) && l.quantity > 0 ? l.quantity : 1),
        unitPrice: String(Number.isFinite(l.unitPrice) && l.unitPrice >= 0 ? l.unitPrice : 0),
      })),
    );
    const lineSum = sumQuoteLineAmounts(sorted);
    const total = suggestedQuoteTotal != null && Number.isFinite(suggestedQuoteTotal) && suggestedQuoteTotal > 0
      ? suggestedQuoteTotal
      : lineSum;
    if (total > 0 && lineSum <= 0) {
      setLines([{ description: "Ukupna ponuda", quantity: "1", unitPrice: amountInputString(total) || "0" }]);
    }
    setNote("");
    setPricesIncludeVat(defaultPricesIncludeVat);
    setPdfFile(undefined);
  }, [defaultPricesIncludeVat, jobQuoteLines, resetForm, suggestedQuoteTotal]);

  const computedTotalAmount = useMemo(() => {
    const normalizedLines = lines
      .map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      }))
      .filter((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);
    return sumQuoteLineAmounts(normalizedLines);
  }, [lines]);

  const onCreate = async () => {
    const normalizedLines = lines
      .map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      }))
      .filter((line) => line.description && line.quantity > 0 && line.unitPrice >= 0);

    if (!Number.isFinite(computedTotalAmount) || computedTotalAmount <= 0 || normalizedLines.length === 0) return;
    await createQuote.mutateAsync({
      jobId,
      totalAmount: computedTotalAmount,
      pricesIncludeVat,
      lines: normalizedLines,
      note,
      isFinalOffer,
      pdfFile,
      authorId: user?.id ?? null,
    });
    resetForm();
    setOpen(false);
  };

  return (
    <div>
      <SectionHeader
        title="Ponude"
        subtitle={`${sortedQuotes.length} ponuda`}
        icon={FileText}
        actions={
          <Dialog
            open={dialogOpen}
            onOpenChange={(next) => {
              if (onCreateDialogOpenChange) onCreateDialogOpenChange(next);
              else setOpen(next);
              if (!next) resetForm();
              else {
                setIsFinalOffer(createMode === "final");
                seedFormFromJob();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <PlusCircle className="w-4 h-4 mr-1" />
                {createMode === "final" ? "Kreiraj finalnu ponudu" : "Nova ponuda"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{createMode === "final" ? "Finalna ponuda" : "Nova ponuda"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <Label htmlFor="is-final-offer">Finalna ponuda</Label>
                    <p className="text-xs text-muted-foreground">
                      Obeležava ponudu kao finalnu za ovaj posao.
                    </p>
                  </div>
                  <Switch
                    id="is-final-offer"
                    checked={isFinalOffer}
                    onCheckedChange={setIsFinalOffer}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <Label htmlFor="quote-prices-include-vat">Cene u ponudi uključuju PDV</Label>
                    <p className="text-xs text-muted-foreground">
                      Ovo podešavanje postaje podrazumevano pri evidentiranju uplata za posao.
                    </p>
                  </div>
                  <Switch
                    id="quote-prices-include-vat"
                    checked={pricesIncludeVat}
                    onCheckedChange={setPricesIncludeVat}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-note">Napomena</Label>
                  <Textarea
                    id="quote-note"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Kratka napomena uz ponudu"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Stavke ponude</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0" }])}
                    >
                      Dodaj stavku
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {lines.map((line, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                        <Input
                          className="col-span-6"
                          placeholder="Opis stavke"
                          value={line.description}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)),
                            )
                          }
                        />
                        <Input
                          className="col-span-2"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, quantity: e.target.value } : it)),
                            )
                          }
                        />
                        <Input
                          className="col-span-3"
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, unitPrice: e.target.value } : it)),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="col-span-1"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
                            )
                          }
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Ukupna cena ponude</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrencyBySettings(computedTotalAmount)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-pdf">PDF ponude</Label>
                  <Input
                    id="quote-pdf"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0])}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Otkaži
                </Button>
                <Button
                  type="button"
                  disabled={createQuote.isPending || computedTotalAmount <= 0}
                  onClick={() => void onCreate()}
                >
                  {createQuote.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Snimanje...
                    </>
                  ) : (
                    isFinalOffer ? "Sačuvaj finalnu ponudu" : "Sačuvaj ponudu"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Učitavanje ponuda...</div>
      ) : sortedQuotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nema kreiranih ponuda"
          description="Dodajte prvu ponudu za ovaj posao."
        />
      ) : (
        <div className="grid gap-3">
          {sortedQuotes.map((quote) => (
            <div key={quote.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm text-foreground">
                    {quote.quoteNumber} <span className="text-muted-foreground">v{quote.versionNumber}</span>
                  </p>
                  <GenericBadge label={labelQuoteStatus(quote.status)} variant={STATUS_VARIANT[quote.status]} />
                  {quote.isFinalOffer && <GenericBadge label="Finalna" variant="success" />}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={quote.status}
                    onValueChange={(next) =>
                      updateQuoteStatus.mutate({
                        quoteId: quote.id,
                        jobId,
                        status: next as QuoteStatus,
                        authorId: user?.id ?? null,
                      })
                    }
                    disabled={updateQuoteStatus.isPending}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Poslata</SelectItem>
                      <SelectItem value="accepted">Prihvaćena</SelectItem>
                      <SelectItem value="rejected">Odbijena</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Ukupna cena</p>
                  <p className="font-medium">{formatCurrencyBySettings(quote.totalAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">PDV u ceni</p>
                  <p className="font-medium">{quote.pricesIncludeVat ? "Da" : "Ne"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kreirano</p>
                  <p className="font-medium">{formatDateByAppLanguage(quote.createdAt)}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground">Napomena</p>
                  <p className="font-medium line-clamp-2">{quote.note || "—"}</p>
                </div>
              </div>
              {quote.lines.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Stavke ponude</p>
                  <div className="space-y-1.5">
                    {quote.lines.map((line) => (
                      <div key={line.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">
                          {line.description} ({line.quantity})
                        </span>
                        <span className="text-muted-foreground">
                          {formatCurrencyBySettings(line.quantity * line.unitPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {quote.fileUrl && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="outline" size="sm" asChild>
                      <a href={quote.fileUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-4 h-4 mr-1" />
                        Otvori PDF
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyQuoteId === quote.id}
                      onClick={async () => {
                        try {
                          setBusyQuoteId(quote.id);
                          await exportQuotePDF(quote, jobId, {
                            attachGeneratedPdf: !!user?.id,
                            userId: user?.id,
                            onPdfAttached: (r) => {
                              queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
                              queryClient.invalidateQueries({ queryKey: ["files", jobId] });
                              toast.success(r === "updated" ? "PDF ponude je ažuriran" : "PDF ponude je sačuvan uz ponudu");
                            },
                            onPdfAttachFailed: (m) =>
                              toast.error("Štampa je otvorena, ali PDF nije sačuvan", { description: m }),
                          });
                        } catch (e) {
                          toast.error("Greška pri generisanju PDF ponude");
                        } finally {
                          setBusyQuoteId(null);
                        }
                      }}
                    >
                      {busyQuoteId === quote.id ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Printer className="w-4 h-4 mr-1" />
                      )}
                      Generiši PDF
                    </Button>
                    <SendQuoteButton
                      jobId={jobId}
                      customerEmail={customerEmail}
                      customerName={customerName}
                      quoteNumber={quote.quoteNumber}
                      quoteTotal={quote.totalAmount}
                      pdfUrl={quote.fileUrl}
                      onSuccess={async () => {
                        await updateQuoteStatus.mutateAsync({
                          quoteId: quote.id,
                          jobId,
                          status: "sent",
                          authorId: user?.id ?? null,
                        });
                        await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
                        await queryClient.invalidateQueries({ queryKey: ["jobs"] });
                        await queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
                      }}
                    />
                  </div>
                </div>
              )}
              {!quote.fileUrl && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyQuoteId === quote.id}
                    onClick={async () => {
                      try {
                        setBusyQuoteId(quote.id);
                        await exportQuotePDF(quote, jobId, {
                          attachGeneratedPdf: !!user?.id,
                          userId: user?.id,
                          onPdfAttached: (r) => {
                            queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
                            queryClient.invalidateQueries({ queryKey: ["files", jobId] });
                            toast.success(r === "updated" ? "PDF ponude je ažuriran" : "PDF ponude je sačuvan uz ponudu");
                          },
                          onPdfAttachFailed: (m) =>
                            toast.error("Štampa je otvorena, ali PDF nije sačuvan", { description: m }),
                        });
                      } catch {
                        toast.error("Greška pri generisanju PDF ponude");
                      } finally {
                        setBusyQuoteId(null);
                      }
                    }}
                  >
                    {busyQuoteId === quote.id ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Printer className="w-4 h-4 mr-1" />
                    )}
                    Generiši PDF
                  </Button>
                  <SendQuoteButton
                    jobId={jobId}
                    customerEmail={customerEmail}
                    customerName={customerName}
                    quoteNumber={quote.quoteNumber}
                    quoteTotal={quote.totalAmount}
                    pdfUrl={quote.fileUrl}
                    onSuccess={async () => {
                      await updateQuoteStatus.mutateAsync({
                        quoteId: quote.id,
                        jobId,
                        status: "sent",
                        authorId: user?.id ?? null,
                      });
                      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
                      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
                      await queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
                    }}
                  />
                </div>
              )}
              {quote.status === "accepted" && (
                <div className="mt-3 text-xs text-success flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Aktivno prihvaćena ponuda
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
