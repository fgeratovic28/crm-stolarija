import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, FileDown, FileText, Loader2, Mail, PlusCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { GenericBadge } from "@/components/shared/StatusBadge";
import { formatCurrencyBySettings, formatDateByAppLanguage, readAppSettingsCache } from "@/lib/app-settings";
import { labelQuoteStatus } from "@/lib/activity-labels";
import { useQuotes } from "@/hooks/use-quotes";
import { useAuthStore } from "@/stores/auth-store";
import { sendMultipleQuotesToClient } from "@/lib/send-multiple-quotes-client";
import { toast } from "sonner";
import type { Quote, QuoteDeliveryMethod, QuoteStatus } from "@/types";
import { labelQuoteDeliveryMethod } from "@/lib/quote-delivery-method";
import { quoteHasAttachments } from "@/lib/quote-attachments";
import { cn } from "@/lib/utils";
import { computeJobAmountsFromLineSum, vatAmountsFromTotalDue } from "@/lib/job-pricing";
import { DEFAULT_OUTGOING_VAT_RATE_PERCENT, VAT_RATE_CHOICES, type VatRatePercent } from "@/lib/vat-constants";
import {
  generateQuotePaymentSlipPdfBlob,
  openQuotePaymentSlipPdf,
  quotePaymentSlipBlobToBase64,
  quotePaymentSlipFilename,
} from "@/lib/quote-payment-slip-pdf";
import {
  buildQuotePaymentSlipInput,
  type QuotePaymentSlipUserFields,
} from "@/lib/quote-payment-slip-fields";
import { QuotePaymentSlipFieldsDialog } from "@/components/modals/QuotePaymentSlipFieldsDialog";
import { quoteAcceptanceRequiresConfirmedPrice } from "@/lib/quote-acceptance-pricing";
import { moneyInputStringFromNumber, parseMoneyInput } from "@/lib/money-input";
import { MoneyInput } from "@/components/shared/MoneyInput";
import type { JobStatus } from "@/types";

const STATUS_VARIANT: Record<QuoteStatus, "muted" | "info" | "success" | "danger"> = {
  draft: "muted",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  zamenjena: "muted",
};

function deliveryBadgeVariant(
  method: QuoteDeliveryMethod,
  quoteStatus: QuoteStatus,
): "muted" | "info" | "success" | "warning" {
  if (method === "not_sent") {
    return quoteStatus === "sent" || quoteStatus === "accepted" ? "warning" : "muted";
  }
  if (method === "email_system") return "info";
  return "success";
}

const ACCEPT_UPLOAD =
  "application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.ms-excel,.xls";



const quoteFileInputClassName = cn(
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background",
  "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
);

export function QuotesTab({
  jobId,
  jobStatus,
  isChildJob = false,
  quotes: initialQuotes,
  customerEmail,
  customerName,
  customerAddress,
}: {
  jobId: string;
  jobStatus?: JobStatus;
  /** Pod-posao (dodatni radovi) — prihvatanje uvek traži iznos. */
  isChildJob?: boolean;
  quotes?: Quote[];
  customerEmail?: string;
  customerName?: string;
  /** Adresa klijenta (npr. fakturisanje) za uplatnicu. */
  customerAddress?: string;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const {
    quotes: fetchedQuotes,
    createQuote,
    updateQuoteStatus,
    markQuoteDeliveryMethod,
    acceptQuote: acceptQuoteMut,
    isLoading,
  } = useQuotes(jobId);
  const quotes = initialQuotes ?? fetchedQuotes;
  const sortedQuotes = useMemo(
    () => [...quotes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [quotes],
  );

  const selectableQuotes = useMemo(() => sortedQuotes.filter((q) => quoteHasAttachments(q)), [sortedQuotes]);

  const [open, setOpen] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const quoteFileInputRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkIncludePaymentSlip, setBulkIncludePaymentSlip] = useState(false);
  const [bulkSlipPoziv, setBulkSlipPoziv] = useState("");
  const [bulkSlipSvrha, setBulkSlipSvrha] = useState("");
  const [bulkSlipIznos, setBulkSlipIznos] = useState("");
  const [slipWithEmailByQuoteId, setSlipWithEmailByQuoteId] = useState<Record<string, boolean>>({});
  const [singleQuoteSendId, setSingleQuoteSendId] = useState<string | null>(null);
  const [paymentSlipQuoteId, setPaymentSlipQuoteId] = useState<string | null>(null);
  const [slipFieldsDialog, setSlipFieldsDialog] = useState<{
    title: string;
    confirmLabel: string;
    description?: string;
    pending: boolean;
    onConfirm: (fields: QuotePaymentSlipUserFields) => Promise<void>;
  } | null>(null);

  const [acceptConfirmOpen, setAcceptConfirmOpen] = useState(false);
  const [acceptQuoteTargetId, setAcceptQuoteTargetId] = useState<string | null>(null);
  const [acceptRequiresPrice, setAcceptRequiresPrice] = useState(true);
  const [acceptFinalPriceStr, setAcceptFinalPriceStr] = useState("");
  const [newQuoteVatRate, setNewQuoteVatRate] = useState<VatRatePercent>(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
  const [newQuotePricesIncludeVat, setNewQuotePricesIncludeVat] = useState(true);
  const [newQuoteIsFinal, setNewQuoteIsFinal] = useState(false);
  const [acceptVatRate, setAcceptVatRate] = useState<VatRatePercent>(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
  const [acceptPricesIncludeVat, setAcceptPricesIncludeVat] = useState(true);

  const selectedCount = selectedIds.size;
  const allSelectableSelected =
    selectableQuotes.length > 0 && selectableQuotes.every((q) => selectedIds.has(q.id));

  const buildPaymentSlipForEmail = useCallback(
    async (
      quoteForSlip: Quote,
      fields: QuotePaymentSlipUserFields,
    ): Promise<{ paymentSlipPdfBase64: string; paymentSlipFilename: string } | null> => {
      const settings = readAppSettingsCache();
      if (!settings.companyBankAccount.trim() || !settings.companyName.trim()) {
        toast.error("Nije moguće generisati uplatnicu", {
          description: "U Podešavanjima → Firma unesite naziv, adresu i tekući račun primaoca.",
        });
        return null;
      }
      const payerName = (customerName || "").trim() || "Kupac";
      const payerAddr = (customerAddress || "").trim() || "—";
      try {
        const blob = await generateQuotePaymentSlipPdfBlob(
          buildQuotePaymentSlipInput(fields, {
            payerName,
            payerAddress: payerAddr,
            recipientName: settings.companyName,
            recipientAddress: settings.companyAddress.trim() || "—",
            recipientAccount: settings.companyBankAccount.trim(),
            quoteNumber: quoteForSlip.quoteNumber,
          }),
          { includeIpsQr: true },
        );
        const paymentSlipPdfBase64 = await quotePaymentSlipBlobToBase64(blob);
        return {
          paymentSlipPdfBase64,
          paymentSlipFilename: quotePaymentSlipFilename(quoteForSlip.quoteNumber),
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Nepoznata greška";
        toast.error("Generisanje uplatnice za mejl nije uspelo", { description: msg });
        return null;
      }
    },
    [customerName, customerAddress],
  );

  const defaultNewQuoteIsFinal =
    jobStatus === "measurement_processing" ||
    jobStatus === "final_quote_sent" ||
    jobStatus === "final_quote_accepted_pending_payment";

  const resetForm = useCallback(() => {
    setVersionName("");
    setFiles([]);
    setNewQuoteVatRate(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
    setNewQuotePricesIncludeVat(true);
    setNewQuoteIsFinal(defaultNewQuoteIsFinal);
    if (quoteFileInputRef.current) quoteFileInputRef.current.value = "";
  }, [defaultNewQuoteIsFinal]);

  const onQuoteFilesChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selected = Array.from(input.files ?? []);
    if (selected.length) setFiles((prev) => [...prev, ...selected]);
    // Reset after the change event so the same file can be picked again; defer so state flush isn't fighting the browser.
    queueMicrotask(() => {
      input.value = "";
    });
  }, []);

  const removeQuoteFileAt = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onCreate = async () => {
    const name = versionName.trim();
    if (!name) {
      toast.error("Unesite naziv verzije");
      return;
    }
    if (files.length < 1) {
      toast.error("Izaberite bar jedan fajl (PDF ili Excel)");
      return;
    }
    await createQuote.mutateAsync({
      jobId,
      versionName: name,
      files,
      vatRatePercent: newQuoteVatRate,
      pricesIncludeVat: newQuotePricesIncludeVat,
      isFinalOffer: !isChildJob && newQuoteIsFinal,
      authorId: user?.id ?? null,
    });
    resetForm();
    setOpen(false);
  };

  const toggleId = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableQuotes.map((q) => q.id)));
  };

  const openAcceptModal = useCallback(
    (quote: Quote) => {
      const requiresPrice = quoteAcceptanceRequiresConfirmedPrice(jobStatus, quote, { isChildJob });
      setAcceptQuoteTargetId(quote.id);
      setAcceptRequiresPrice(requiresPrice);
      if (requiresPrice) {
        const n = Number(quote.totalAmount);
        setAcceptFinalPriceStr(Number.isFinite(n) && n > 0 ? moneyInputStringFromNumber(n) : "");
        const vr = quote.vatRatePercent === 20 ? 20 : 0;
        setAcceptVatRate(vr);
        setAcceptPricesIncludeVat(quote.pricesIncludeVat !== false);
      } else {
        setAcceptFinalPriceStr("");
        setAcceptVatRate(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
        setAcceptPricesIncludeVat(true);
      }
      setAcceptConfirmOpen(true);
    },
    [jobStatus, isChildJob],
  );

  const closeAcceptModal = useCallback(() => {
    setAcceptConfirmOpen(false);
    setAcceptQuoteTargetId(null);
    setAcceptRequiresPrice(true);
    setAcceptFinalPriceStr("");
    setAcceptVatRate(DEFAULT_OUTGOING_VAT_RATE_PERCENT);
    setAcceptPricesIncludeVat(true);
  }, []);

  const acceptPricingPreview = useMemo(() => {
    const amt = parseMoneyInput(acceptFinalPriceStr);
    if (amt == null || amt <= 0) {
      return { base: 0, vat: 0, total: 0, empty: true as const };
    }
    if (acceptVatRate === 0) {
      return { base: amt, vat: 0, total: amt, empty: false as const };
    }
    const breakdown = acceptPricesIncludeVat
      ? vatAmountsFromTotalDue(amt, acceptVatRate)
      : computeJobAmountsFromLineSum(amt, false, acceptVatRate);
    return {
      base: breakdown.priceWithoutVat,
      vat: breakdown.vatAmount,
      total: breakdown.totalPrice,
      empty: false as const,
    };
  }, [acceptFinalPriceStr, acceptVatRate, acceptPricesIncludeVat]);

  const submitAcceptQuote = async () => {
    if (!acceptQuoteTargetId) return;
    let totalPrice: number | undefined;
    let vatRatePercent: VatRatePercent | undefined;
    let pricesIncludeVat: boolean | undefined;

    if (acceptRequiresPrice) {
      if (acceptPricingPreview.empty) {
        toast.error("Unesite konačan iznos (> 0).");
        return;
      }
      totalPrice = acceptPricingPreview.total;
      if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
        toast.error("Unesite konačan iznos (> 0).");
        return;
      }
      vatRatePercent = acceptVatRate;
      pricesIncludeVat = acceptVatRate === 0 ? true : acceptPricesIncludeVat;
    }

    try {
      await acceptQuoteMut.mutateAsync({
        quoteId: acceptQuoteTargetId,
        jobId,
        totalPrice,
        vatRatePercent,
        pricesIncludeVat,
        authorId: user?.id ?? null,
      });
      closeAcceptModal();
    } catch {
      /* toast u hook-u */
    }
  };

  const onBulkSend = async () => {
    if (selectedCount < 1) return;
    setBulkSending(true);
    try {
      const orderedSelected = sortedQuotes.filter((q) => selectedIds.has(q.id));
      let slipPayload: {
        includePaymentSlip: true;
        paymentSlipPdfBase64: string;
        paymentSlipFilename: string;
      } | null = null;
      if (bulkIncludePaymentSlip) {
        const primary = orderedSelected[0];
        if (!primary) {
          toast.error("Izaberite ponude za slanje.");
          return;
        }
        const poziv = bulkSlipPoziv.trim();
        const svrha = bulkSlipSvrha.trim();
        const iznosRaw = bulkSlipIznos.trim();
        if (!poziv || !svrha) {
          toast.error("Unesite poziv na broj i svrhu uplate za uplatnicu.");
          return;
        }
        if (iznosRaw) {
          const parsed = parseMoneyInput(iznosRaw);
          if (parsed == null || parsed <= 0) {
            toast.error("Unesite ispravan iznos uplate ili ostavite polje prazno.");
            return;
          }
        }
        const slip = await buildPaymentSlipForEmail(primary, {
          pozivNaBroj: poziv,
          svrhaUplate: svrha,
          ...(iznosRaw ? { iznosUplate: iznosRaw } : {}),
        });
        if (!slip) return;
        slipPayload = { includePaymentSlip: true, ...slip };
      }
      const res = await sendMultipleQuotesToClient({
        jobId,
        quoteIds: orderedSelected.map((q) => q.id),
        message: bulkMessage.trim() || undefined,
        ...(slipPayload ?? {}),
      });
      if (!res.ok) {
        toast.error(res.error || "Slanje nije uspelo.");
        return;
      }
      toast.success(res.message || "Ponude su poslate.");
      setBulkOpen(false);
      setBulkMessage("");
      setBulkIncludePaymentSlip(false);
      setBulkSlipPoziv("");
      setBulkSlipSvrha("");
      setBulkSlipIznos("");
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } finally {
      setBulkSending(false);
    }
  };

  const downloadPaymentSlipPdf = (quote: Quote) => {
    const settings = readAppSettingsCache();
    if (!settings.companyBankAccount.trim()) {
      toast.error("Nije podešen račun primaoca", {
        description: "U Podešavanjima → Firma unesite broj tekućeg računa (Račun primaoca).",
      });
      return;
    }
    if (!settings.companyName.trim()) {
      toast.error("Nije podešen primalac", {
        description: "U Podešavanjima → Firma unesite naziv i adresu firme.",
      });
      return;
    }
    setSlipFieldsDialog({
      title: "Podaci za uplatnicu",
      confirmLabel: "Preuzmi PDF",
      description: "Unesite poziv na broj i svrhu uplate. Iznos je opcion. Polje modela na obrascu ostaje prazno.",
      pending: false,
      onConfirm: async (fields) => {
        setSlipFieldsDialog((d) => (d ? { ...d, pending: true } : null));
        setPaymentSlipQuoteId(quote.id);
        try {
          const payerName = (customerName || "").trim() || "Kupac";
          const payerAddr = (customerAddress || "").trim() || "—";
          const blob = await generateQuotePaymentSlipPdfBlob(
            buildQuotePaymentSlipInput(fields, {
              payerName,
              payerAddress: payerAddr,
              recipientName: settings.companyName,
              recipientAddress: settings.companyAddress.trim() || "—",
              recipientAccount: settings.companyBankAccount.trim(),
              quoteNumber: quote.quoteNumber,
            }),
            { includeIpsQr: true },
          );
          openQuotePaymentSlipPdf(blob, quote.quoteNumber);
          setSlipFieldsDialog(null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Nepoznata greška";
          toast.error("Generisanje uplatnice nije uspelo", { description: msg });
          setSlipFieldsDialog((d) => (d ? { ...d, pending: false } : null));
        } finally {
          setPaymentSlipQuoteId(null);
        }
      },
    });
  };

  const sendQuoteEmailToClient = async (
    quoteId: string,
    slipFields?: QuotePaymentSlipUserFields,
  ): Promise<boolean> => {
    setSingleQuoteSendId(quoteId);
    try {
      const quote = sortedQuotes.find((q) => q.id === quoteId);
      let slipPart: {
        includePaymentSlip: true;
        paymentSlipPdfBase64: string;
        paymentSlipFilename: string;
      } | null = null;
      if (slipFields && quote) {
        const slip = await buildPaymentSlipForEmail(quote, slipFields);
        if (!slip) return false;
        slipPart = { includePaymentSlip: true, ...slip };
      }
      const res = await sendMultipleQuotesToClient({
        jobId,
        quoteIds: [quoteId],
        ...(slipPart ?? {}),
      });
      if (!res.ok) {
        toast.error(res.error || "Slanje nije uspelo.");
        return false;
      }
      toast.success(res.message || "Ponuda je poslata.");
      await queryClient.invalidateQueries({ queryKey: ["quotes", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      return true;
    } finally {
      setSingleQuoteSendId(null);
    }
  };

  const onSendThisQuoteToClient = (quoteId: string) => {
    const quote = sortedQuotes.find((q) => q.id === quoteId);
    const wantSlip = slipWithEmailByQuoteId[quoteId] === true;
    if (wantSlip && quote) {
      setSlipFieldsDialog({
        title: "Uplatnica uz ponudu",
        confirmLabel: "Pošalji mejlom",
        description: "Unesite poziv na broj i svrhu uplate pre slanja mejla. Iznos je opcion.",
        pending: false,
        onConfirm: async (fields) => {
          setSlipFieldsDialog((d) => (d ? { ...d, pending: true } : null));
          const ok = await sendQuoteEmailToClient(quoteId, fields);
          if (ok) setSlipFieldsDialog(null);
          else setSlipFieldsDialog((d) => (d ? { ...d, pending: false } : null));
        },
      });
      return;
    }
    void sendQuoteEmailToClient(quoteId);
  };

  return (
    <div>
      <SectionHeader
        title="Ponude"
        subtitle={`${sortedQuotes.length} ponuda`}
        icon={FileText}
        actions={
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) setNewQuoteIsFinal(defaultNewQuoteIsFinal);
              if (!next) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm">
                <PlusCircle className="w-4 h-4 mr-1" />
                Nova ponuda
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Nova ponuda</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="quote-version-name">Naziv verzije</Label>
                  <Input
                    id="quote-version-name"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    placeholder="npr. Opcija 1 - Rehau"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    {newQuoteIsFinal
                      ? "Finalna ponuda: pri slanju status posla ide na „Poslata finalna ponuda“, pri prihvatanju traži se konačan iznos."
                      : "Početna ponuda se prihvata bez iznosa; konačan iznos unosite pri finalnoj ponudi."}
                  </p>
                </div>
                {!isChildJob ? (
                  <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="quote-is-final"
                        checked={newQuoteIsFinal}
                        onCheckedChange={(v) => setNewQuoteIsFinal(v === true)}
                      />
                      <Label htmlFor="quote-is-final" className="text-sm font-medium leading-snug cursor-pointer">
                        Finalna ponuda
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Označite ako je ovo ponuda posle merenja ili prva/ jedina ponuda na starom poslu. Pri slanju
                      klijentu posao prelazi u „Poslata finalna ponuda“; pri prihvatanju i uplati — u „Spremno za rad“
                      (isto kao kod obrade mera).
                    </p>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Stopa PDV</Label>
                    <Select
                      value={String(newQuoteVatRate)}
                      onValueChange={(v) => setNewQuoteVatRate(v === "20" ? 20 : 0)}
                    >
                      <SelectTrigger id="new-quote-vat-rate">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VAT_RATE_CHOICES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <div className="flex items-start gap-2 w-full">
                      <Checkbox
                        id="new-quote-prices-vat"
                        checked={newQuotePricesIncludeVat}
                        onCheckedChange={(v) => setNewQuotePricesIncludeVat(v === true)}
                      />
                      <Label htmlFor="new-quote-prices-vat" className="text-xs font-normal leading-snug cursor-pointer">
                        Jedinične cene u prilogu sa uključenim PDV-om (bruto stavke)
                      </Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-file">Prilozi (PDF ili Excel; može više odjednom)</Label>
                  <p className="text-xs text-muted-foreground">
                    Možete više puta da izaberete fajlove — lista se sabira. Uklonite stavku sa X ako treba.
                  </p>
                  <input
                    ref={quoteFileInputRef}
                    id="quote-file"
                    name="quote-file"
                    type="file"
                    accept={ACCEPT_UPLOAD}
                    multiple
                    className={quoteFileInputClassName}
                    onChange={onQuoteFilesChange}
                  />
                  {files.length >= 1 ? (
                    <ul className="mt-2 rounded-md border border-border bg-muted/30 divide-y divide-border max-h-40 overflow-y-auto">
                      {files.map((file, index) => (
                        <li
                          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                          className="flex items-center gap-2 px-2.5 py-1.5 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground" title={file.name}>
                            {file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeQuoteFileAt(index)}
                            className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={`Ukloni ${file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Otkaži
                </Button>
                <Button type="button" disabled={createQuote.isPending} onClick={() => void onCreate()}>
                  {createQuote.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Otprema…
                    </>
                  ) : (
                    "Sačuvaj ponudu"
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
        <EmptyState icon={FileText} title="Nema ponuda" description="Dodajte prvu ponudu otpremanjem fajla." />
      ) : (
        <div className="mt-4 space-y-3">
          {selectedCount >= 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={singleQuoteSendId !== null}
                onClick={() => {
                  setBulkSlipPoziv("");
                  setBulkSlipSvrha("");
                  setBulkOpen(true);
                }}
              >
                <Mail className="w-4 h-4 mr-1" />
                Pošalji izabrane klijentu
              </Button>
              <span className="text-xs text-muted-foreground">{selectedCount} izabrano</span>
            </div>
          )}

          <Dialog
            open={bulkOpen}
            onOpenChange={(next) => {
              setBulkOpen(next);
              if (!next) {
                setBulkIncludePaymentSlip(false);
                setBulkSlipPoziv("");
                setBulkSlipSvrha("");
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Slanje ponuda klijentu</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {(customerEmail || customerName) && (
                  <p className="text-muted-foreground">
                    {customerName ? <span className="text-foreground font-medium">{customerName}</span> : "Klijent"}
                    {customerEmail ? (
                      <>
                        {" "}
                        · <span className="text-foreground">{customerEmail}</span>
                      </>
                    ) : null}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Jedna ponuda može da ima više fajlova; jedan mejl sa svim prilozima izabranih ponuda; ponude se
                  označavaju kao poslate; status posla postaje „Ponuda poslata”. Način slanja se automatski beleži kao
                  „Email (sistem)”.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="bulk-msg">Poruka (opciono)</Label>
                  <Textarea
                    id="bulk-msg"
                    rows={4}
                    value={bulkMessage}
                    onChange={(e) => setBulkMessage(e.target.value)}
                    placeholder="Kratka poruka uz ponude…"
                  />
                </div>
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3">
                  <Checkbox
                    id="bulk-include-slip"
                    checked={bulkIncludePaymentSlip}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setBulkIncludePaymentSlip(on);
                      if (on) {
                        setBulkSlipPoziv("");
                        setBulkSlipSvrha("");
                        setBulkSlipIznos("");
                      }
                    }}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor="bulk-include-slip" className="text-sm font-medium cursor-pointer leading-tight">
                      Pošalji i uplatnicu (nalog za uplatu)
                    </Label>
                    <p className="text-xs text-muted-foreground leading-snug">
                      PDF kao na obrascu; iznos je opcion. Model na obrascu ostaje prazan.
                    </p>
                  </div>
                </div>
                {bulkIncludePaymentSlip ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
                    <p className="text-xs text-muted-foreground leading-snug">
                      U prilogu ide uplatnica sa IPS QR kodom (NBS). Iznos unesite samo ako želite da bude na uplatnici.
                    </p>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-slip-poziv">Poziv na broj *</Label>
                      <Input
                        id="bulk-slip-poziv"
                        value={bulkSlipPoziv}
                        onChange={(e) => setBulkSlipPoziv(e.target.value)}
                        placeholder="npr. broj ponude"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-slip-svrha">Svrha uplate *</Label>
                      <Input
                        id="bulk-slip-svrha"
                        value={bulkSlipSvrha}
                        onChange={(e) => setBulkSlipSvrha(e.target.value)}
                        placeholder="npr. Uplata po ponudi br. …"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-slip-iznos">Iznos uplate (opciono)</Label>
                      <MoneyInput
                        id="bulk-slip-iznos"
                        value={bulkSlipIznos}
                        onValueChange={setBulkSlipIznos}
                        placeholder="npr. 12.345,67"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkSending}>
                  Otkaži
                </Button>
              <Button type="button" disabled={bulkSending || singleQuoteSendId !== null} onClick={() => void onBulkSend()}>
                  {bulkSending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Šaljem…
                    </>
                  ) : (
                    "Pošalji"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelectableSelected}
                      onCheckedChange={(v) => toggleSelectAll(v === true)}
                      disabled={selectableQuotes.length === 0}
                      aria-label="Izaberi sve sa prilogom"
                    />
                  </TableHead>
                  <TableHead>Naziv verzije</TableHead>
                  <TableHead className="text-right">Iznos</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[9.5rem]">Način slanja</TableHead>
                  <TableHead className="text-center w-px px-3 min-w-[11rem]">
                    <span className="sr-only">Slanje i evidencija</span>
                    <Mail className="inline h-4 w-4 text-muted-foreground" aria-hidden />
                  </TableHead>
                  <TableHead className="text-right min-w-[10rem]">Prilozi / uplatnica</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedQuotes.map((quote) => {
                  const canSelect = quoteHasAttachments(quote);
                  const showMarkAccepted =
                    canSelect &&
                    quote.status !== "accepted" &&
                    quote.status !== "zamenjena" &&
                    quote.status !== "rejected";
                  const statusDisabled =
                    updateQuoteStatus.isPending ||
                    acceptQuoteMut.isPending ||
                    markQuoteDeliveryMethod.isPending ||
                    quote.status === "zamenjena";
                  const deliveryBusy = markQuoteDeliveryMethod.isPending;
                  const attList: { url: string; filename?: string }[] = quote.fileAttachments?.length
                    ? quote.fileAttachments!.map((a) => ({
                        url: a.url,
                        filename: a.filename,
                      }))
                    : quote.fileUrl
                      ? [{ url: quote.fileUrl }]
                      : [];
                  return (
                    <TableRow
                      key={quote.id}
                      className={cn(
                        quote.status === "zamenjena" && "bg-muted/40 text-muted-foreground",
                        quote.status === "accepted" && "bg-primary/[0.07]",
                      )}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(quote.id)}
                          disabled={!canSelect}
                          onCheckedChange={(v) => toggleId(quote.id, v === true)}
                          aria-label={`Izaberi ponudu ${quote.quoteNumber}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {quote.versionName?.trim() || `${quote.quoteNumber} v${quote.versionNumber}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrencyBySettings(quote.totalAmount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDateByAppLanguage(quote.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2 min-w-0 max-w-xl">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            {quote.status === "zamenjena" ? (
                              <GenericBadge label="Stara verzija (Pre merenja)" variant="muted" />
                            ) : (
                              <GenericBadge
                                label={labelQuoteStatus(quote.status)}
                                variant={STATUS_VARIANT[quote.status]}
                              />
                            )}
                            {quote.status === "accepted" ? (
                              <span className="text-sm font-semibold tabular-nums text-primary whitespace-nowrap">
                                Potvrđeno: {formatCurrencyBySettings(quote.totalAmount)}
                              </span>
                            ) : null}
                          </div>
                          {showMarkAccepted ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/25 p-2 w-fit max-w-full">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="shrink-0 border-2 border-border shadow-sm bg-background hover:bg-accent"
                                onClick={() => openAcceptModal(quote)}
                              >
                                Označi kao prihvaćenu
                              </Button>
                            </div>
                          ) : null}
                          {quote.status !== "zamenjena" ? (
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
                              disabled={statusDisabled}
                            >
                              <SelectTrigger className="h-8 min-w-[140px] max-w-[200px]">
                                <SelectValue placeholder="Status" />
                              </SelectTrigger>
                              <SelectContent>
                                {quote.status === "accepted" ? (
                                  <SelectItem value="accepted" disabled>
                                    Prihvaćena (trenutna)
                                  </SelectItem>
                                ) : null}
                                <SelectItem value="draft">Nacrt</SelectItem>
                                <SelectItem value="sent">Poslata</SelectItem>
                                <SelectItem value="rejected">Odbijena</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="align-middle text-sm">
                        {quote.status === "zamenjena" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span title="Evidencija kako je klijent dobio ponudu">
                            <GenericBadge
                              label={labelQuoteDeliveryMethod(quote.deliveryMethod)}
                              variant={deliveryBadgeVariant(quote.deliveryMethod, quote.status)}
                            />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-middle">
                        {quote.status === "zamenjena" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border bg-muted/25 p-2 min-w-[10.5rem]">
                            {canSelect ? (
                              <>
                                <div className="flex items-start gap-2 text-left px-0.5">
                                  <Checkbox
                                    id={`email-slip-${quote.id}`}
                                    checked={slipWithEmailByQuoteId[quote.id] === true}
                                    onCheckedChange={(v) => {
                                      const on = v === true;
                                      setSlipWithEmailByQuoteId((prev) => ({
                                        ...prev,
                                        [quote.id]: on,
                                      }));
                                    }}
                                    disabled={bulkSending || singleQuoteSendId !== null || deliveryBusy}
                                  />
                                  <Label
                                    htmlFor={`email-slip-${quote.id}`}
                                    className="text-[10px] leading-snug text-muted-foreground font-normal cursor-pointer"
                                  >
                                    Priloži i <span className="text-foreground font-medium">uplatnicu</span> (PDF)
                                  </Label>
                                </div>
                                {slipWithEmailByQuoteId[quote.id] === true ? (
                                  <p className="text-[10px] text-muted-foreground leading-snug rounded-md border border-border/80 bg-background/60 px-1.5 py-1.5">
                                    Uplatnica uvek sa IPS QR (NBS).
                                  </p>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="shrink-0 border-2 border-border shadow-sm bg-background hover:bg-accent w-full justify-center"
                                  disabled={bulkSending || singleQuoteSendId !== null || deliveryBusy}
                                  onClick={() => void onSendThisQuoteToClient(quote.id)}
                                >
                                  {singleQuoteSendId === quote.id ? (
                                    <>
                                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                      Šaljem…
                                    </>
                                  ) : (
                                    <>
                                      <Mail className="w-4 h-4 mr-1" />
                                      Pošalji mejlom
                                    </>
                                  )}
                                </Button>
                              </>
                            ) : (
                              <p className="text-[10px] text-muted-foreground text-center px-0.5">
                                Bez priloga nema slanja iz CRM-a
                              </p>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between border-2 border-border shadow-sm bg-background hover:bg-accent"
                                  disabled={
                                    bulkSending || singleQuoteSendId !== null || deliveryBusy || statusDisabled
                                  }
                                >
                                  <span className="truncate">Označi kao poslato…</span>
                                  <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                  Kako je klijent dobio ponudu?
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-sm"
                                  onSelect={() =>
                                    void markQuoteDeliveryMethod.mutateAsync({
                                      quoteId: quote.id,
                                      jobId,
                                      deliveryMethod: "email_system",
                                      authorId: user?.id ?? null,
                                    })
                                  }
                                >
                                  Email (sistem)
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-sm"
                                  onSelect={() =>
                                    void markQuoteDeliveryMethod.mutateAsync({
                                      quoteId: quote.id,
                                      jobId,
                                      deliveryMethod: "viber_whatsapp",
                                      authorId: user?.id ?? null,
                                    })
                                  }
                                >
                                  Viber / WhatsApp
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-sm"
                                  onSelect={() =>
                                    void markQuoteDeliveryMethod.mutateAsync({
                                      quoteId: quote.id,
                                      jobId,
                                      deliveryMethod: "printed_in_person",
                                      authorId: user?.id ?? null,
                                    })
                                  }
                                >
                                  Štampano / uživo
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-sm"
                                  onSelect={() =>
                                    void markQuoteDeliveryMethod.mutateAsync({
                                      quoteId: quote.id,
                                      jobId,
                                      deliveryMethod: "other",
                                      authorId: user?.id ?? null,
                                    })
                                  }
                                >
                                  Ostalo
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col gap-1.5 items-end">
                          {attList.length >= 1 ? (
                            <>
                              {attList.map((att, ix) => (
                                <Button key={`${quote.id}:${ix}:${att.url}`} variant="outline" size="sm" asChild>
                                  <a href={att.url} target="_blank" rel="noreferrer">
                                    <ExternalLink className="w-4 h-4 mr-1" />
                                    {attList.length > 1 ? `Prilog ${ix + 1}` : "Otvori ponudu"}
                                    {typeof att.filename === "string" && att.filename.trim() ? (
                                      <span className="truncate max-w-[9rem]" title={att.filename}>
                                        {" "}
                                        ({att.filename})
                                      </span>
                                    ) : null}
                                  </a>
                                </Button>
                              ))}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Nema priloga</span>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 border-2 border-border shadow-sm bg-background hover:bg-accent"
                            disabled={
                              paymentSlipQuoteId === quote.id ||
                              bulkSending ||
                              singleQuoteSendId !== null
                            }
                            onClick={() => downloadPaymentSlipPdf(quote)}
                          >
                            {paymentSlipQuoteId === quote.id ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                PDF…
                              </>
                            ) : (
                              <>
                                <FileDown className="w-4 h-4 mr-1" />
                                Preuzmi uplatnicu
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Dialog
            open={acceptConfirmOpen}
            onOpenChange={(open) => {
              if (!open) closeAcceptModal();
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {acceptRequiresPrice ? "Potvrdite konačnu cenu za ovu ponudu" : "Potvrdite prihvatanje ponude"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                {acceptRequiresPrice ? (
                  <>
                <div className="space-y-1.5">
                  <Label htmlFor="accept-final-price">
                    {acceptPricesIncludeVat || acceptVatRate === 0
                      ? "Ukupna cena za naplatu *"
                      : "Osnovica (zbir stavki bez PDV-a) *"}
                  </Label>
                  <MoneyInput
                    id="accept-final-price"
                    required
                    value={acceptFinalPriceStr}
                    onValueChange={setAcceptFinalPriceStr}
                    placeholder="0,00"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Stopa PDV</Label>
                    <Select
                      value={String(acceptVatRate)}
                      onValueChange={(v) => {
                        const next = v === "20" ? 20 : 0;
                        setAcceptVatRate(next);
                        if (next === 0) setAcceptPricesIncludeVat(true);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VAT_RATE_CHOICES.map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {r}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <div className="flex items-start gap-2 w-full">
                      <Checkbox
                        id="accept-prices-include-vat"
                        checked={acceptPricesIncludeVat}
                        onCheckedChange={(v) => setAcceptPricesIncludeVat(v === true)}
                        disabled={acceptVatRate === 0}
                      />
                      <Label
                        htmlFor="accept-prices-include-vat"
                        className="text-xs font-normal leading-snug cursor-pointer"
                      >
                        Iznos gore je sa PDV-om (bruto)
                      </Label>
                    </div>
                  </div>
                </div>
                {!acceptPricingPreview.empty ? (
                  <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Analiza</p>
                    <div className="flex justify-between tabular-nums">
                      <span>Osnovica</span>
                      <span>{formatCurrencyBySettings(acceptPricingPreview.base)}</span>
                    </div>
                    <div className="flex justify-between tabular-nums">
                      <span>Iznos PDV-a ({acceptVatRate}%)</span>
                      <span>{formatCurrencyBySettings(acceptPricingPreview.vat)}</span>
                    </div>
                    <div className="flex justify-between font-semibold tabular-nums pt-1 border-t border-border">
                      <span>Ukupna cena</span>
                      <span>{formatCurrencyBySettings(acceptPricingPreview.total)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Unesite iznos da biste videli raščlambu.</p>
                )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Početna ponuda se prihvata bez unosa iznosa. Konačna cena na poslu će biti uneta pri prihvatanju
                    finalne ponude posle merenja.
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => closeAcceptModal()} disabled={acceptQuoteMut.isPending}>
                  Otkaži
                </Button>
                <Button
                  type="button"
                  disabled={acceptQuoteMut.isPending}
                  onClick={() => void submitAcceptQuote()}
                >
                  {acceptQuoteMut.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      Čuvanje…
                    </>
                  ) : (
                    "Potvrdi prihvatanje"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      <QuotePaymentSlipFieldsDialog
        open={slipFieldsDialog !== null}
        onOpenChange={(open) => {
          if (!open && !slipFieldsDialog?.pending) setSlipFieldsDialog(null);
        }}
        title={slipFieldsDialog?.title ?? ""}
        description={slipFieldsDialog?.description}
        confirmLabel={slipFieldsDialog?.confirmLabel ?? "Potvrdi"}
        pending={slipFieldsDialog?.pending ?? false}
        onConfirm={async (fields) => {
          if (!slipFieldsDialog) return;
          await slipFieldsDialog.onConfirm(fields);
        }}
      />
    </div>
  );
}
