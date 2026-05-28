import { useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { MaterialOrderFormValues } from "@/lib/material-order-form-schema";
import { Input } from "@/components/ui/input";

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-0.5 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  );
}

export function MaterialOrderImportedLinesCollapsible({
  control,
  setValue,
}: {
  control: Control<MaterialOrderFormValues>;
  setValue: UseFormSetValue<MaterialOrderFormValues>;
}) {
  const nbLines = useWatch({ control, name: "nbLines" }) ?? [];
  const imported = nbLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.procurementMeta?.article?.trim());
  if (imported.length === 0) return null;

  return (
    <Collapsible className="group rounded-lg border border-border bg-muted/15">
      <CollapsibleTrigger
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium",
          "hover:bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-lg",
          "group-data-[state=open]:border-b group-data-[state=open]:border-border",
        )}
      >
        <span>Pregled uvezenih stavki ({imported.length})</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden px-4 py-3 space-y-4 text-sm">
        {imported.map(({ line, index }, i) => {
          const m = line.procurementMeta!;
          return (
            <div
              key={`${i}-${m.article}`}
              className="rounded-md border border-border/80 bg-background/80 p-3 space-y-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{line.description || m.article}</p>
                <span className="text-xs tabular-nums text-muted-foreground shrink-0">
                  {line.quantity} {line.unit || "kom"}
                </span>
              </div>
              <div className="space-y-1 border-t border-border/60 pt-2">
                <MetaRow label="Nalog" value={m.work_order ?? ""} />
                <MetaRow label="Pozicija" value={m.position ?? ""} />
                <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground shrink-0">Šifra</span>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Unesite šifru"
                    value={m.article_code ?? ""}
                    onChange={(e) => {
                      setValue(`nbLines.${index}.procurementMeta.article_code`, e.target.value, {
                        shouldDirty: true,
                        shouldValidate: false,
                      });
                    }}
                  />
                </div>
                <MetaRow label="Artikal" value={m.article} />
                <MetaRow label="Boja" value={m.color ?? ""} />
                <MetaRow label="JM" value={m.uom ?? ""} />
                {m.length_mm != null && Number.isFinite(m.length_mm) ? (
                  <MetaRow label="Dužina" value={`${m.length_mm} mm`} />
                ) : null}
              </div>
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}
