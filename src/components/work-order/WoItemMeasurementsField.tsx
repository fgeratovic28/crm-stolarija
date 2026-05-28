import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WorkOrderItem } from "@/types";

type WoItemMeasurementsFieldProps = {
  row: Pick<WorkOrderItem, "id" | "measurements">;
  disabledSaving: boolean;
  isSaving: boolean;
  onSave: (itemId: string, text: string) => void;
};

/** Polje mera uz pojedinačnu stavku ček liste (merenje / verifikacija). */
export function WoItemMeasurementsField({
  row,
  disabledSaving,
  isSaving,
  onSave,
}: WoItemMeasurementsFieldProps) {
  const [value, setValue] = useState(row.measurements ?? "");
  useEffect(() => {
    setValue(row.measurements ?? "");
  }, [row.measurements]);

  return (
    <div className="ml-2 pl-8 space-y-1.5 border-l-2 border-primary/25 pl-3 py-2 rounded-r-md bg-muted/30">
      <Label htmlFor={`wo-item-mere-${row.id}`} className="text-[11px] font-semibold uppercase text-muted-foreground">
        Mere za ovu stavku
      </Label>
      <Textarea
        id={`wo-item-mere-${row.id}`}
        rows={3}
        className="text-sm resize-y min-h-[4rem]"
        placeholder="Upišite dimenzije ili mere (vide se u izveštaju uz ovu stavku)…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabledSaving || isSaving}
        onBlur={() => {
          const trimmed = value.trim();
          if (trimmed !== (row.measurements ?? "").trim()) {
            onSave(row.id, trimmed);
          }
        }}
      />
      {isSaving ? <p className="text-[11px] text-muted-foreground">Čuvanje…</p> : null}
    </div>
  );
}
