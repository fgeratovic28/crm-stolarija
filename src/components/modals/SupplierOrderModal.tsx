import { useState } from "react";
import { Check, Copy, Download, Loader2, Send } from "lucide-react";
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

type CopyFieldKey = "to" | "subject" | "body";

type SupplierOrderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  subject: string;
  body: string;
  documentLabel?: string;
  onDownloadDocument: () => Promise<void> | void;
  onMarkAsSent: () => Promise<void> | void;
};

export function SupplierOrderModal({
  open,
  onOpenChange,
  recipientEmail,
  subject,
  body,
  documentLabel = "Preuzmi dokument porudžbine",
  onDownloadDocument,
  onMarkAsSent,
}: SupplierOrderModalProps) {
  const [copiedField, setCopiedField] = useState<CopyFieldKey | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isMarkingSent, setIsMarkingSent] = useState(false);

  const copyToClipboard = async (field: CopyFieldKey, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1400);
    } catch {
      toast.error("Kopiranje nije uspelo");
    }
  };

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

  const handleMarkAsSent = async () => {
    setIsMarkingSent(true);
    try {
      await onMarkAsSent();
      onOpenChange(false);
      toast.success("Porudžbina je označena kao poslata");
    } catch (error) {
      toast.error("Ažuriranje statusa nije uspelo", {
        description: error instanceof Error ? error.message : "Nepoznata greška.",
      });
    } finally {
      setIsMarkingSent(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pošalji porudžbinu dobavljaču</DialogTitle>
          <DialogDescription>
            Ovo je ručni workflow: kopirajte podatke, pošaljite iz svog email klijenta, pa označite porudžbinu kao
            poslatu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="supplier-order-to">To</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => void copyToClipboard("to", recipientEmail)}
              >
                {copiedField === "to" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedField === "to" ? "Kopirano!" : "Kopiraj"}
              </Button>
            </div>
            <Input id="supplier-order-to" value={recipientEmail} readOnly />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="supplier-order-subject">Subject</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => void copyToClipboard("subject", subject)}
              >
                {copiedField === "subject" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedField === "subject" ? "Kopirano!" : "Kopiraj"}
              </Button>
            </div>
            <Input id="supplier-order-subject" value={subject} readOnly />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="supplier-order-body">Body</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => void copyToClipboard("body", body)}
              >
                {copiedField === "body" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedField === "body" ? "Kopirano!" : "Kopiraj"}
              </Button>
            </div>
            <Textarea id="supplier-order-body" rows={8} value={body} readOnly className="text-sm" />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            onClick={() => void handleDownload()}
            disabled={isDownloading || isMarkingSent}
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {documentLabel}
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            onClick={() => void handleMarkAsSent()}
            disabled={isMarkingSent || isDownloading}
          >
            {isMarkingSent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Označi kao poslato
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
