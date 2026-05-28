import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { QuotePaymentSlipUserFields } from "@/lib/quote-payment-slip-fields";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { parseMoneyInput } from "@/lib/money-input";

type QuotePaymentSlipFieldsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Zadržano radi kompatibilnosti poziva; polja se uvek otvaraju prazna. */
  defaultFields?: QuotePaymentSlipUserFields;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: (fields: QuotePaymentSlipUserFields) => void | Promise<void>;
};

export function QuotePaymentSlipFieldsDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
}: QuotePaymentSlipFieldsDialogProps) {
  const [pozivNaBroj, setPozivNaBroj] = useState("");
  const [svrhaUplate, setSvrhaUplate] = useState("");
  const [iznosUplate, setIznosUplate] = useState("");

  useEffect(() => {
    if (!open) return;
    setPozivNaBroj("");
    setSvrhaUplate("");
    setIznosUplate("");
  }, [open]);

  const handleConfirm = async () => {
    const poziv = pozivNaBroj.trim();
    const svrha = svrhaUplate.trim();
    const iznosRaw = iznosUplate.trim();
    if (!poziv) {
      toast.error("Unesite poziv na broj.");
      return;
    }
    if (!svrha) {
      toast.error("Unesite svrhu uplate.");
      return;
    }
    if (iznosRaw) {
      const parsed = parseMoneyInput(iznosRaw);
      if (parsed == null || parsed <= 0) {
        toast.error("Unesite ispravan iznos uplate ili ostavite polje prazno.");
        return;
      }
    }
    await onConfirm({
      pozivNaBroj: poziv,
      svrhaUplate: svrha,
      ...(iznosRaw ? { iznosUplate: iznosRaw } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="slip-poziv">Poziv na broj *</Label>
            <Input
              id="slip-poziv"
              value={pozivNaBroj}
              onChange={(e) => setPozivNaBroj(e.target.value)}
              placeholder="npr. broj ponude ili referenca"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">Model na obrascu ostaje prazan.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slip-svrha">Svrha uplate *</Label>
            <Input
              id="slip-svrha"
              value={svrhaUplate}
              onChange={(e) => setSvrhaUplate(e.target.value)}
              placeholder="npr. Uplata po ponudi br. …"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slip-iznos">Iznos uplate (opciono)</Label>
            <MoneyInput
              id="slip-iznos"
              value={iznosUplate}
              onValueChange={setIznosUplate}
              placeholder="npr. 12.345,67"
            />
            <p className="text-xs text-muted-foreground">
              Ako ostavite prazno, polje iznosa na uplatnici i u IPS QR kodu ostaje prazno.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Otkaži
          </Button>
          <Button type="button" disabled={pending} onClick={() => void handleConfirm()}>
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Molimo sačekajte…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
