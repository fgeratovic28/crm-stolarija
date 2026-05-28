import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFiles } from "@/hooks/use-files";
import { useAuthStore } from "@/stores/auth-store";
import type { MaterialOrder } from "@/types";
import { mergeDefined } from "@/lib/merge-defined";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { moneyInputStringFromNumber, parseMoneyInput, roundMoneyInput } from "@/lib/money-input";

type MaterialOrderSupplierProformaFormProps = {
  order: MaterialOrder;
  disabled?: boolean;
  onSaved: (next: MaterialOrder) => Promise<void>;
};

/**
 * Posle slanja porudžbine dobavljaču: predračun na R2 + iznos → status čeka uplatu.
 */
export function MaterialOrderSupplierProformaForm({
  order,
  disabled,
  onSaved,
}: MaterialOrderSupplierProformaFormProps) {
  const { uploadFile } = useFiles();
  const { user } = useAuthStore();
  const [file, setFile] = useState<File | null>(null);
  const [total, setTotal] = useState(() => {
    const pref =
      order.supplierProformaTotal != null && Number.isFinite(order.supplierProformaTotal)
        ? order.supplierProformaTotal
        : order.price > 0
          ? order.price
          : null;
    return moneyInputStringFromNumber(pref);
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user?.id) {
      toast.error("Morate biti prijavljeni.");
      return;
    }
    if (!file) {
      toast.error("Izaberite fajl predračuna.");
      return;
    }
    const price = parseMoneyInput(total);
    if (price == null || price <= 0) {
      toast.error("Unesite ispravan ukupan iznos (veći od 0).");
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadFile.mutateAsync({
        materialOrderId: order.id,
        jobId: order.jobId,
        category: "supplier",
        file,
        uploadedBy: user.id,
      });
      const url = uploaded.storageUrl?.trim();
      if (!url) {
        throw new Error("Fajl je otpremljen, ali nema storage URL.");
      }
      const next = mergeDefined(order, {
        supplierProformaUrl: url,
        supplierProformaTotal: roundMoneyInput(price),
        price: roundMoneyInput(price),
        supplierPrice: roundMoneyInput(price),
        deliveryStatus: "waiting_for_payment" as const,
      }) as MaterialOrder;
      await onSaved(next);
      setFile(null);
      toast.success("Predračun je sačuvan i status narudžbine je ažuriran.");
    } catch (e) {
      toast.error("Snimanje nije uspelo", {
        description: e instanceof Error ? e.message : "Nepoznata greška.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
      <p className="text-xs font-medium text-foreground">Odgovor dobavljača — predračun</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`proforma-file-${order.id}`}>Otpremi predračun</Label>
          <Input
            id={`proforma-file-${order.id}`}
            type="file"
            disabled={disabled || busy}
            className="cursor-pointer"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`proforma-total-${order.id}`}>Ukupna cena (RSD)</Label>
          <MoneyInput
            id={`proforma-total-${order.id}`}
            value={total}
            onValueChange={setTotal}
            disabled={disabled || busy}
          />
        </div>
      </div>
      <Button type="button" size="sm" className="gap-2" disabled={disabled || busy} onClick={() => void submit()}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        Sačuvaj predračun i ažuriraj status
      </Button>
    </div>
  );
}
