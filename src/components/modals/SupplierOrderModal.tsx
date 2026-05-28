import { useEffect, useState } from "react";
import { Download, Loader2, Paperclip, Send } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  loadProcurementSupplierEmailSignature,
  saveProcurementSupplierEmailSignature,
} from "@/lib/procurement-supplier-email-signature";

type SupplierOrderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  defaultSubject: string;
  attachmentLabel?: string;
  documentLabel?: string;
  onDownloadDocument: () => Promise<void> | void;
  onSendEmail: (payload: { subject: string; message: string; signature: string }) => Promise<void>;
  isSending?: boolean;
};

export function SupplierOrderModal({
  open,
  onOpenChange,
  recipientEmail,
  defaultSubject,
  attachmentLabel = "PDF porudžbenice je automatski priložen uz mejl.",
  documentLabel = "Preuzmi PDF porudžbenice",
  onDownloadDocument,
  onSendEmail,
  isSending = false,
}: SupplierOrderModalProps) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState(() => loadProcurementSupplierEmailSignature());
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(defaultSubject);
    setMessage("");
    setSignature(loadProcurementSupplierEmailSignature());
  }, [open, defaultSubject]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      saveProcurementSupplierEmailSignature(signature);
    }, 400);
    return () => window.clearTimeout(t);
  }, [open, signature]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await onDownloadDocument();
    } catch (error) {
      toast.error("Preuzimanje dokumenta nije uspelo", {
        description: error instanceof Error ? error.message : "Nepoznata greška.",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSend = async () => {
    const subj = subject.trim();
    const sig = signature.trim();
    if (!subj) {
      toast.error("Unesite naslov mejla.");
      return;
    }
    if (!sig) {
      toast.error("Unesite potpis u footeru mejla.");
      return;
    }
    if (!recipientEmail.trim() || recipientEmail.includes("Nije unet")) {
      toast.error("Dobavljač nema email adresu u šifarniku.");
      return;
    }
    saveProcurementSupplierEmailSignature(signature);
    try {
      await onSendEmail({ subject: subj, message: message.trim(), signature: sig });
      onOpenChange(false);
      toast.success("Porudžbina je poslata dobavljaču mejlom");
    } catch (error) {
      toast.error("Slanje mejla nije uspelo", {
        description: error instanceof Error ? error.message : "Nepoznata greška.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pošalji porudžbinu dobavljaču</DialogTitle>
          <DialogDescription>
            Pregled odgovara izgledu mejla. Potpis u footeru se čuva dok ga ne promenite. PDF porudžbenice ide u
            prilogu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <Paperclip className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{attachmentLabel}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-order-to">Primalac</Label>
            <Input id="supplier-order-to" value={recipientEmail} readOnly />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="supplier-order-subject">Naslov</Label>
            <Input
              id="supplier-order-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Sadržaj mejla</Label>
            <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
              <div className="p-3 sm:p-4">
                <Textarea
                  id="supplier-order-message"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isSending}
                  className="min-h-[120px] resize-y border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Unesite tekst poruke (opciono)…"
                />
              </div>

              <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 sm:px-4 sm:py-4 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Potpis (footer)
                </p>
                <Textarea
                  id="supplier-order-signature"
                  rows={4}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  disabled={isSending}
                  className="min-h-[88px] resize-y border-0 bg-transparent p-0 text-sm leading-relaxed text-slate-600 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-400"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Footer sa potpisom u mejlu izgleda isto kao u pregledu (linija iznad potpisa, siva pozadina).
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            onClick={() => void handleDownload()}
            disabled={isDownloading || isSending}
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {documentLabel}
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={() => void handleSend()}
            disabled={isSending || isDownloading}
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Pošalji mejl
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
