import { useEffect, useMemo, useState } from "react";
import { FileSearch2, Loader2, Mail, Upload } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrencyBySettings } from "@/lib/app-settings";
import { normalizeOrderLines, sumOrderLinesNet } from "@/lib/material-order-lines";
import {
  applyInvoiceReconciliationToOrder,
  buildReconciliationRows,
  reconciliationHasMismatch,
  reconciliationHasUnmatched,
} from "@/lib/material-order-sef-reconcile";
import { parseSupplierInvoiceXml, type ParsedUblDocument } from "@/lib/sef-invoice-xml-parser";
import type { MaterialOrder } from "@/types";
import type { UploadFileInput } from "@/hooks/use-files";

type UploadFileMutation = {
  mutateAsync: (input: UploadFileInput) => Promise<unknown>;
  isPending: boolean;
};

function buildSupplierMailto(order: MaterialOrder, complaintBody: string): string {
  const to = order.supplierEmail?.trim();
  if (!to) return "";
  const jobRef = order.job?.jobNumber ? `Posao ${order.job.jobNumber}` : "Narudžbina materijala";
  const subject = `Reklamacija — ${jobRef} — ${order.supplier}`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(complaintBody.trim())}`;
}

type Props = {
  order: MaterialOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string;
  userId?: string | null;
  canUpload: boolean;
  uploadFile: UploadFileMutation;
  onSaveOrder: (next: MaterialOrder) => void;
  onApplyInvoiceReconciliation: (next: MaterialOrder, meta: { xmlDocumentNumber?: string }) => Promise<void>;
  isSaving: boolean;
  onFilesChanged: () => void;
};

export function MaterialOrderSefDialog({
  order,
  open,
  onOpenChange,
  jobId,
  userId,
  canUpload,
  uploadFile,
  onSaveOrder,
  onApplyInvoiceReconciliation,
  isSaving,
  onFilesChanged,
}: Props) {
  const [xmlPreview, setXmlPreview] = useState<ParsedUblDocument | null>(null);
  const [xmlFileName, setXmlFileName] = useState("");
  const [complaintDraft, setComplaintDraft] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setComplaintDraft(order.supplierComplaintNote ?? "");
    setXmlPreview(null);
    setXmlFileName("");
    setApplyBusy(false);
  }, [open, order?.id, order?.supplierComplaintNote]);

  const crmLines = useMemo(() => (order ? normalizeOrderLines(order) : []), [order]);
  const crmTotal = useMemo(() => (crmLines.length ? sumOrderLinesNet(crmLines) : 0), [crmLines]);

  const reconcileRows = useMemo(
    () => buildReconciliationRows(crmLines, xmlPreview?.lines ?? []),
    [crmLines, xmlPreview],
  );

  const mailtoHref = order ? buildSupplierMailto(order, complaintDraft) : "";

  const handlePickXml = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,text/xml,application/xml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? "");
        const parsed = parseSupplierInvoiceXml(text);
        if (!parsed || parsed.lines.length === 0) {
          toast.error("XML nije prepoznat kao UBL / SEF e-račun ili nema stavki.");
          setXmlPreview(null);
          setXmlFileName("");
          return;
        }
        setXmlPreview(parsed);
        setXmlFileName(file.name);
        toast.success("Faktura učitana — proverite poređenje ispod.");
      };
      reader.readAsText(file, "UTF-8");
    };
    input.click();
  };

  const handleUploadXmlAsAttachment = async () => {
    if (!order || !userId || !canUpload) {
      toast.error("Niste prijavljeni ili nemate pravo otpremanja.");
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml,text/xml,application/xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await uploadFile.mutateAsync({
          materialOrderId: order.id,
          jobId: order.jobId || jobId,
          category: "supplier",
          file,
          uploadedBy: userId,
        });
        onFilesChanged();
        toast.success("XML fakture je sačuvan uz priloge narudžbine.");
      } catch {
        /* toast u useFiles */
      }
    };
    input.click();
  };

  const handleSaveComplaint = () => {
    if (!order) return;
    onSaveOrder({ ...order, supplierComplaintNote: complaintDraft.trim() || undefined });
  };

  const handleApplyInvoice = async () => {
    if (!order || !xmlPreview) return;
    if (!crmLines.length) {
      toast.error("Narudžbina nema stavki za usklađivanje (dodajte stavke u narudžbinu).");
      return;
    }
    setApplyBusy(true);
    try {
      const next = applyInvoiceReconciliationToOrder(order, crmLines, xmlPreview.lines);
      await onApplyInvoiceReconciliation(next, { xmlDocumentNumber: xmlPreview.documentNumber });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Primena fakture nije uspela.");
    } finally {
      setApplyBusy(false);
    }
  };

  if (!order) return null;

  const hasMismatch = reconciliationHasMismatch(reconcileRows);
  const hasUnmatched = reconciliationHasUnmatched(reconcileRows);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSearch2 className="w-5 h-5 shrink-0" />
            SEF faktura i usklađivanje
          </DialogTitle>
          <DialogDescription>
            Učitajte XML fakture dobavljača (UBL / SEF). Sistem upoređuje stavke sa narudžbinom; nakon potvrde
            ažuriraju se količine, nabavne cene i status isporuke. Reklamacija i mejl ostaju kao ranije.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={handlePickXml}>
              <Upload className="w-4 h-4 mr-1.5" />
              Učitaj XML fakture
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleUploadXmlAsAttachment()}
              disabled={!canUpload || !userId || uploadFile.isPending}
            >
              {uploadFile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Sačuvaj XML kao prilog
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleApplyInvoice()}
              disabled={isSaving || applyBusy || !xmlPreview || !crmLines.length}
            >
              {applyBusy || isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              Potvrdi prijem i primeni iz fakture
            </Button>
          </div>
          {order.sefReconciliationAt ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Poslednja potvrda usklađenosti: {new Date(order.sefReconciliationAt).toLocaleString("sr-RS")}
            </p>
          ) : null}
          {xmlFileName ? <p className="text-xs text-muted-foreground">Fajl: {xmlFileName}</p> : null}
          {xmlPreview?.documentNumber ? (
            <p className="text-xs">
              <span className="text-muted-foreground">Broj fakture (XML):</span> {xmlPreview.documentNumber}
            </p>
          ) : null}

          {xmlPreview && reconcileRows.length > 0 ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                  Poređenje stavki
                </p>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  {hasMismatch ? (
                    <span className="rounded bg-amber-500/15 text-amber-800 dark:text-amber-200 px-2 py-0.5 font-medium">
                      Razlika u količini ili iznosu
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 font-medium">
                      Parovi se poklapaju (tolerancija)
                    </span>
                  )}
                  {hasUnmatched ? (
                    <span className="rounded bg-orange-500/15 text-orange-900 dark:text-orange-100 px-2 py-0.5 font-medium">
                      Višak stavki sa jedne strane
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="overflow-x-auto max-h-[min(52vh,420px)] overflow-y-auto rounded border border-border/80">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Tip</TableHead>
                      <TableHead>Naziv (CRM / faktura)</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Kol. narudžbina</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Kol. XML</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Jed. cena XML</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Iznos XML</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconcileRows.map((r) => {
                      const kindLabel =
                        r.kind === "paired" ? "Par" : r.kind === "crm_only" ? "Samo CRM" : "Samo faktura";
                      const nameCell =
                        r.kind === "xml_only"
                          ? r.xmlDescription
                          : r.kind === "crm_only"
                            ? r.crmDescription
                            : `${r.crmDescription} ↔ ${r.xmlDescription}`;
                      const qtyCrm = r.kind === "xml_only" ? "—" : String(r.crmQuantity);
                      const qtyXml = r.xmlQuantity != null ? String(r.xmlQuantity) : "—";
                      const unitXml =
                        r.xmlUnitPrice != null && r.xmlUnitPrice > 0
                          ? formatCurrencyBySettings(r.xmlUnitPrice)
                          : "—";
                      const netXml = r.xmlLineNet != null ? formatCurrencyBySettings(r.xmlLineNet) : "—";
                      const rowWarn =
                        r.kind === "paired" && (r.quantityDiffers || r.lineNetDiffers)
                          ? "bg-amber-500/10"
                          : r.kind !== "paired"
                            ? "bg-orange-500/10"
                            : "";
                      return (
                        <TableRow key={r.rowIndex} className={rowWarn}>
                          <TableCell className="text-xs font-medium whitespace-nowrap">{kindLabel}</TableCell>
                          <TableCell className="text-xs max-w-[220px]">{nameCell}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{qtyCrm}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums font-medium">{qtyXml}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{unitXml}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{netXml}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Ukupno narudžbina (bez PDV): <strong>{formatCurrencyBySettings(crmTotal)}</strong>
                {xmlPreview.taxExclusiveTotal != null ? (
                  <>
                    {" "}
                    · ukupno iz XML-a: <strong>{formatCurrencyBySettings(xmlPreview.taxExclusiveTotal)}</strong>
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Učitajte XML da bi se prikazalo poređenje.</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="sef-complaint">Reklamacija / primedba dobavljaču</Label>
            <Textarea
              id="sef-complaint"
              rows={5}
              value={complaintDraft}
              onChange={(e) => setComplaintDraft(e.target.value)}
              placeholder="Opišite odstupanja (količina, cena, artikal…) ili zatražite korekciju."
              className="text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={handleSaveComplaint} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Sačuvaj tekst reklamacije
              </Button>
              {mailtoHref ? (
                <Button type="button" size="sm" variant="outline" asChild>
                  <a href={mailtoHref}>
                    <Mail className="w-4 h-4 mr-1.5 inline" />
                    Otvori mejl dobavljaču
                  </a>
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled>
                  <Mail className="w-4 h-4 mr-1.5" />
                  Otvori mejl dobavljaču
                </Button>
              )}
            </div>
            {!order.supplierEmail?.trim() ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Nema e-mail adrese dobavljača na narudžbini — dopunite je u šifarniku dobavljača da bi mejl radio.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Otvara se podrazumevani klijent e-pošte sa adresom: {order.supplierEmail}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
