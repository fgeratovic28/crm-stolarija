import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Receipt, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import { moneyInputStringFromNumber, parseMoneyInput, roundMoneyInput } from "@/lib/money-input";
import { parseSupplierInvoiceXml } from "@/lib/sef-invoice-xml-parser";
import { DEFAULT_OUTGOING_VAT_RATE_PERCENT } from "@/lib/vat-constants";
import type { MaterialOrder } from "@/types";
import type { UploadFileInput } from "@/hooks/use-files";

type UploadFileMutation = {
  mutateAsync: (input: UploadFileInput) => Promise<{ storageUrl?: string }>;
  isPending: boolean;
};

export type MaterialOrderInvoiceEvidencijaDialogProps = {
  order: MaterialOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string;
  userId?: string | null;
  canUpload: boolean;
  uploadFile: UploadFileMutation;
  onPersist: (next: MaterialOrder) => Promise<void>;
  isSaving: boolean;
  onFilesChanged?: () => void;
};

/** Predračun (ako postoji), inače ukupna cena narudžbine sa CRM-a — kao predlog za iznos fakture. */
function estimatedInvoiceSuggestionAmount(order: MaterialOrder): number | null {
  const proforma = order.supplierProformaTotal;
  if (proforma != null && Number.isFinite(proforma) && proforma > 0) {
    return Math.round(proforma * 100) / 100;
  }
  const p = Number(order.price);
  if (Number.isFinite(p) && p > 0) return Math.round(p * 100) / 100;
  return null;
}

/** Stopa za predlog ulaznog PDV-a: sa porudžbine ako je uneta, inače podrazumevana. */
function vatRatePercentForIncomingSuggestion(order: MaterialOrder): number {
  const p = Number(order.nbVatRatePercent);
  if (Number.isFinite(p) && p > 0 && p <= 100) return p;
  return DEFAULT_OUTGOING_VAT_RATE_PERCENT;
}

/** PDV od iste osnovice kao predviđeni iznos fakture (pretpostavka: osnovica bez PDV-a). */
function estimatedIncomingVatFromNetBase(order: MaterialOrder, netBase: number): number | null {
  if (!Number.isFinite(netBase) || netBase <= 0) return null;
  const rate = vatRatePercentForIncomingSuggestion(order);
  if (rate <= 0) return null;
  return Math.round((netBase * rate) / 100 * 100) / 100;
}

function extractXmlAutofill(xmlText: string): {
  invoiceNumber?: string;
  invoiceAmount?: number;
  invoiceVatAmount?: number;
  hadAny: boolean;
  recognized: boolean;
} {
  const parsed = parseSupplierInvoiceXml(xmlText);
  if (!parsed) {
    return { hadAny: false, recognized: false };
  }
  const invoiceNumber = parsed.documentNumber?.trim() || undefined;
  let invoiceAmount: number | undefined;
  if (parsed.taxExclusiveTotal != null && Number.isFinite(parsed.taxExclusiveTotal)) {
    invoiceAmount = Math.round(parsed.taxExclusiveTotal * 100) / 100;
  }
  let invoiceVatAmount: number | undefined;
  if (
    parsed.documentVatAmount != null &&
    Number.isFinite(parsed.documentVatAmount) &&
    parsed.documentVatAmount > 0
  ) {
    invoiceVatAmount = Math.round(parsed.documentVatAmount * 100) / 100;
  }
  const hadAny = Boolean(invoiceNumber || invoiceAmount != null || invoiceVatAmount != null);
  return { invoiceNumber, invoiceAmount, invoiceVatAmount, hadAny, recognized: true };
}

export function MaterialOrderInvoiceEvidencijaDialog({
  order,
  open,
  onOpenChange,
  jobId,
  userId,
  canUpload,
  uploadFile,
  onPersist,
  isSaving,
  onFilesChanged,
}: MaterialOrderInvoiceEvidencijaDialogProps) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [supplierIncomingVat, setSupplierIncomingVat] = useState("");
  const [invoiceFileUrl, setInvoiceFileUrl] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  const suggestedAmount = useMemo(() => (order ? estimatedInvoiceSuggestionAmount(order) : null), [order]);
  const suggestedVatAmount = useMemo(() => {
    if (!order || suggestedAmount == null) return null;
    return estimatedIncomingVatFromNetBase(order, suggestedAmount);
  }, [order, suggestedAmount]);

  /** Samo pri otvaranju / drugoj narudžbini — ne na svaku promenu `order` sa servera (npr. posle otpreme URL-a), da XML autofill ne bi bio obrisan. */
  useEffect(() => {
    if (!open || !order) return;
    setInvoiceNumber(order.invoiceNumber?.trim() ?? "");
    setInvoiceAmount(
      moneyInputStringFromNumber(order.invoiceAmount),
    );
    setSupplierIncomingVat(
      order.supplierIncomingVatAmount != null && Number.isFinite(order.supplierIncomingVatAmount)
        ? moneyInputStringFromNumber(order.supplierIncomingVatAmount)
        : "",
    );
    setInvoiceFileUrl(order.invoiceFileUrl?.trim() ?? "");
  }, [open, order?.id]);

  if (!order) return null;

  const paymentStatus = order.paymentStatus ?? "pending";
  const buildPatchedOrder = (patch: Partial<MaterialOrder>): MaterialOrder => ({ ...order, ...patch });

  const handleSaveEvidencija = async () => {
    const amtParsed = invoiceAmount.trim() ? parseMoneyInput(invoiceAmount) : null;
    const vatParsed = supplierIncomingVat.trim() ? parseMoneyInput(supplierIncomingVat) : null;
    if (invoiceAmount.trim() && amtParsed == null) {
      toast.error("Iznos fakture nije ispravan.");
      return;
    }
    if (supplierIncomingVat.trim() && vatParsed == null) {
      toast.error("Iznos ulaznog PDV-a nije ispravan.");
      return;
    }
    try {
      await onPersist(
        buildPatchedOrder({
          invoiceNumber: invoiceNumber.trim() || undefined,
          invoiceAmount: amtParsed != null ? roundMoneyInput(amtParsed) : undefined,
          supplierIncomingVatAmount:
            supplierIncomingVat.trim() === ""
              ? 0
              : vatParsed != null
                ? roundMoneyInput(Math.max(0, vatParsed))
                : undefined,
          invoiceFileUrl: invoiceFileUrl.trim() || undefined,
        }),
      );
      toast.success("Evidencija fakture je sačuvana.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Snimanje nije uspelo.");
    }
  };

  const handlePickInvoiceFile = () => {
    if (!userId || !canUpload) {
      toast.error("Niste prijavljeni ili nemate pravo otpremanja.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*,.xml,application/xml,text/xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      const looksXml = lower.endsWith(".xml") || file.type.includes("xml");

      let xmlInvoiceNumber: string | undefined;
      let xmlInvoiceAmount: number | undefined;
      let xmlInvoiceVat: number | undefined;
      let xmlRecognized = false;

      if (looksXml) {
        try {
          const text = await file.text();
          const extracted = extractXmlAutofill(text);
          xmlRecognized = extracted.recognized;
          if (extracted.invoiceNumber) {
            xmlInvoiceNumber = extracted.invoiceNumber;
            setInvoiceNumber(extracted.invoiceNumber);
          }
          if (extracted.invoiceAmount != null) {
            xmlInvoiceAmount = extracted.invoiceAmount;
            setInvoiceAmount(moneyInputStringFromNumber(extracted.invoiceAmount));
          }
          if (extracted.invoiceVatAmount != null) {
            xmlInvoiceVat = extracted.invoiceVatAmount;
            setSupplierIncomingVat(moneyInputStringFromNumber(extracted.invoiceVatAmount));
          }
          if (extracted.hadAny) {
            toast.success("Podaci iz XML fakture su učitani (možete ih izmeniti pre čuvanja).");
          } else if (extracted.recognized) {
            toast.message("XML je prepoznat", {
              description: "Nije pronađen broj dokumenta niti ukupan iznos bez PDV-a — unesite ručno.",
            });
          } else {
            toast.message("XML nije prepoznat kao faktura", {
              description: "Popunite polja ručno; fajl će ipak biti otpremljen.",
            });
          }
        } catch {
          toast.error("Čitanje XML fajla nije uspelo.");
        }
      }

      setUploadBusy(true);
      try {
        const uploaded = await uploadFile.mutateAsync({
          materialOrderId: order.id,
          jobId: order.jobId || jobId,
          category: "supplier",
          file,
          uploadedBy: userId,
        });
        const url = uploaded.storageUrl?.trim();
        if (url) {
          setInvoiceFileUrl(url);
          try {
            const persistPatch: Partial<MaterialOrder> = { invoiceFileUrl: url };
            if (xmlInvoiceNumber) persistPatch.invoiceNumber = xmlInvoiceNumber;
            if (xmlInvoiceAmount != null) persistPatch.invoiceAmount = xmlInvoiceAmount;
            if (xmlInvoiceVat != null) persistPatch.supplierIncomingVatAmount = xmlInvoiceVat;
            await onPersist(buildPatchedOrder(persistPatch));
            if (looksXml && xmlRecognized && (xmlInvoiceNumber || xmlInvoiceAmount != null)) {
              toast.success("Dokument je na R2; broj i iznos su sačuvani u narudžbini.");
            } else {
              toast.success(looksXml ? "XML je otpremljen; URL je sačuvan." : "Faktura je otpremljena i URL je sačuvan.");
            }
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Snimanje nije uspelo.");
          }
        }
      } catch {
        /* toast u useFiles */
      } finally {
        setUploadBusy(false);
      }
      onFilesChanged?.();
    };
    input.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-5 h-5 shrink-0" />
            Evidencija fakture / plaćanja
          </DialogTitle>
          <DialogDescription>
            Prvo izaberite dokument (PDF, slika ili SEF XML). Za XML sistem pokušava da upiše broj i iznos; svi fajlovi se
            čuvaju na R2.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
            <p>
              <span className="text-muted-foreground">Dobavljač: </span>
              <span className="font-medium">{order.supplier}</span>
            </p>
            {order.job?.jobNumber ? (
              <p>
                <span className="text-muted-foreground">Referenca posla: </span>
                <span className="font-medium">{order.job.jobNumber}</span>
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Status plaćanja (avans): </span>
              <span className="font-medium">
                {paymentStatus === "paid_advance" ? "Plaćeno u avansu" : "Neplaćeno"}
              </span>
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <Label className="text-foreground">Dokument fakture</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-2"
                disabled={!canUpload || !userId || uploadFile.isPending || uploadBusy}
                onClick={() => void handlePickInvoiceFile()}
              >
                {uploadBusy || uploadFile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Izaberite dokument
              </Button>
              {invoiceFileUrl ? (
                <Button type="button" variant="outline" size="sm" className="gap-2" asChild>
                  <a href={invoiceFileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Otvori prilog
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              PDF ili slika — samo čuvanje linka. XML (SEF) — broj fakture, osnovica i PDV kada su u dokumentu; polja
              možete ručno ispraviti pre čuvanja.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-number">Broj fakture</Label>
            <Input
              id="inv-number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="npr. 12-1/2026"
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-amount">Iznos fakture (RSD)</Label>
            <MoneyInput
              id="inv-amount"
              value={invoiceAmount}
              onValueChange={setInvoiceAmount}
              placeholder="npr. 125.000,00"
            />
            {suggestedAmount != null ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Predviđen iznos (narudžbina / predračun):{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrencyBySettings(suggestedAmount)}
                </span>
                {" · "}
                <button
                  type="button"
                  className="text-primary font-medium underline underline-offset-2 hover:text-primary/90"
                  onClick={() => setInvoiceAmount(moneyInputStringFromNumber(suggestedAmount))}
                >
                  Koristi ovaj iznos
                </button>
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-vat-in">Ulazni PDV (RSD)</Label>
            <MoneyInput
              id="inv-vat-in"
              value={supplierIncomingVat}
              onValueChange={setSupplierIncomingVat}
              placeholder="npr. 20.000,00"
            />
            {suggestedVatAmount != null && suggestedAmount != null ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                Predviđeni ulazni PDV ({vatRatePercentForIncomingSuggestion(order)}% od predviđene osnovice{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrencyBySettings(suggestedAmount)}
                </span>
                ):{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCurrencyBySettings(suggestedVatAmount)}
                </span>
                {" · "}
                <button
                  type="button"
                  className="text-primary font-medium underline underline-offset-2 hover:text-primary/90"
                  onClick={() => setSupplierIncomingVat(moneyInputStringFromNumber(suggestedVatAmount))}
                >
                  Koristi ovaj iznos
                </button>
              </p>
            ) : null}
            <p className="text-[11px] text-muted-foreground leading-snug">
              Iznos PDV-a sa fakture dobavljača (za PDV presek u finansijama). Ostavite prazno za 0.
            </p>
          </div>

        </div>

        <DialogFooter className="flex flex-wrap gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Zatvori
            </Button>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleSaveEvidencija()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Sačuvaj evidenciju
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
