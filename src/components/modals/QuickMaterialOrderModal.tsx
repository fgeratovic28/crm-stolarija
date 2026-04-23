import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSuppliers } from "@/hooks/use-suppliers";
import type { QuickMaterialOrderItemInput } from "@/hooks/use-material-orders";

type DraftRow = {
  id: string;
  supplierId: string;
  itemName: string;
  quantity: string;
  unit: string;
  note: string;
};

type QuickMaterialOrderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (rows: QuickMaterialOrderItemInput[]) => Promise<void>;
  isSubmitting?: boolean;
};

const defaultRow = (seed: string, supplierId = ""): DraftRow => ({
  id: seed,
  supplierId,
  itemName: "",
  quantity: "1",
  unit: "kom",
  note: "",
});

export function QuickMaterialOrderModal({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: QuickMaterialOrderModalProps) {
  const { suppliers } = useSuppliers();
  const activeSuppliers = useMemo(() => (suppliers ?? []).filter((s) => s.active), [suppliers]);
  const [rows, setRows] = useState<DraftRow[]>([defaultRow("1")]);
  const [error, setError] = useState("");

  const updateRow = (id: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const handleAddRow = () => {
    const previousSupplier = rows[rows.length - 1]?.supplierId ?? "";
    setRows((prev) => [...prev, defaultRow(String(Date.now()), previousSupplier)]);
  };

  const handleRemoveRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
  };

  const reset = () => {
    setRows([defaultRow("1")]);
    setError("");
  };

  const handleSubmit = async () => {
    const parsed: QuickMaterialOrderItemInput[] = [];
    for (const row of rows) {
      const itemName = row.itemName.trim();
      const unit = row.unit.trim();
      const quantity = Number(row.quantity);

      if (!row.supplierId || !itemName || !unit || !Number.isFinite(quantity) || quantity <= 0) {
        setError("Popunite dobavljača, naziv artikla, količinu i jedinicu za svaki red.");
        return;
      }
      parsed.push({
        supplierId: row.supplierId,
        itemName,
        quantity,
        unit,
        note: row.note.trim() || undefined,
      });
    }

    setError("");
    await onSubmit(parsed);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          reset();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-full sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Naruči materijal</DialogTitle>
          <DialogDescription>
            Brzi unos stavki iz posla. Sistem će automatski grupisati stavke po dobavljaču.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {rows.map((row, index) => (
            <div key={row.id} className="rounded-lg border border-border p-3 grid grid-cols-1 md:grid-cols-12 gap-2">
              <div className="md:col-span-3 space-y-1">
                <Label>Dobavljač *</Label>
                <Select
                  value={row.supplierId}
                  onValueChange={(value) => updateRow(row.id, { supplierId: value })}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Izaberite dobavljača" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeSuppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-4 space-y-1">
                <Label>Naziv artikla *</Label>
                <Input
                  value={row.itemName}
                  onChange={(e) => updateRow(row.id, { itemName: e.target.value })}
                  disabled={isSubmitting}
                  placeholder="npr. PVC profil 70mm"
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <Label>Količina *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>

              <div className="md:col-span-2 space-y-1">
                <Label>Jedinica *</Label>
                <Input
                  value={row.unit}
                  onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                  disabled={isSubmitting}
                  placeholder="kom / m / kg"
                />
              </div>

              <div className="md:col-span-1 flex items-end justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveRow(row.id)}
                  disabled={isSubmitting || rows.length === 1}
                  aria-label={`Obriši red ${index + 1}`}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="md:col-span-12 space-y-1">
                <Label>Napomena</Label>
                <Textarea
                  value={row.note}
                  onChange={(e) => updateRow(row.id, { note: e.target.value })}
                  disabled={isSubmitting}
                  placeholder="Opciono"
                  rows={2}
                />
              </div>
            </div>
          ))}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button type="button" variant="outline" onClick={handleAddRow} disabled={isSubmitting}>
            <Plus className="w-4 h-4 mr-1" />
            Dodaj red
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Otkaži
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
              {isSubmitting ? "Slanje..." : "Pošalji narudžbine"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
