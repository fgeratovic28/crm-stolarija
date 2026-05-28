import { useState } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { NarudzbenicaFieldsValues, MaterialOrderLineFormValues } from "@/lib/material-order-form-schema";
import {
  PROCUREMENT_FIELD_LABELS_COMPACT,
} from "@/lib/procurement-excel-import";
import { cn } from "@/lib/utils";

/** Jasno odvojen sklopivi naslov za nabavna polja. */
const collapsibleBarTriggerClass =
  "w-full justify-between rounded-md border border-border bg-muted/40 px-3 py-2.5 text-left text-xs font-medium text-foreground shadow-sm hover:bg-muted/55 hover:border-muted-foreground/20";

interface NarudzbenicaFieldsProps {
  control: Control<NarudzbenicaFieldsValues>;
}

const defaultLine = {
  description: "",
  quantity: 1,
  unit: "kom",
  lineNet: 0,
  materialType: undefined as string | undefined,
};

export function NarudzbenicaFields({ control }: NarudzbenicaFieldsProps) {
  const [procurementOpen, setProcurementOpen] = useState<Record<string, boolean>>({});

  const { fields, append, remove } = useFieldArray({
    control,
    name: "nbLines",
  });

  useWatch({ control, name: "nbLines" }) as MaterialOrderLineFormValues[] | undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm font-medium text-foreground">
          Stavke
        </p>

        {fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border border-border bg-background p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Stavka {index + 1}
              </span>
              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-destructive hover:text-destructive"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Ukloni
                </Button>
              )}
            </div>

            <FormField
              control={control}
              name={`nbLines.${index}.description`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Naziv / opis</FormLabel>
                  <FormControl>
                    <Input placeholder="npr. Staklo float 6 mm" {...f} value={f.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={control}
                name={`nbLines.${index}.quantity`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Količina</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min={0.0001}
                        {...f}
                        value={f.value === undefined || f.value === null ? "" : f.value}
                        onChange={(e) => {
                          const v = e.target.value;
                          f.onChange(v === "" ? undefined : Number(v.replace(",", ".")));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name={`nbLines.${index}.unit`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>JM</FormLabel>
                    <FormControl>
                      <Input placeholder="kom, m²…" {...f} value={f.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </div>

            <Collapsible
              open={Boolean(procurementOpen[field.id])}
              onOpenChange={(open) => setProcurementOpen((prev) => ({ ...prev, [field.id]: open }))}
            >
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className={cn(collapsibleBarTriggerClass, "font-normal")}>
                  <span className="text-muted-foreground">Opciono — nabavna polja (nalog, poz., šifra, boja, dužina)</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 opacity-70 transition-transform",
                      procurementOpen[field.id] ? "rotate-180" : "",
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mb-3 text-[11px] text-muted-foreground border-t border-border/80 pt-3">
                  Artikal, količina i JM dolaze iz reda iznad. Ovde samo dodatne nabavne kolone (isti smisao kao mapiranje
                  Excel kolona, bez fajla).
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <FormField
                    control={control}
                    name={`nbLines.${index}.procurementMeta.work_order`}
                    render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[11px]">{PROCUREMENT_FIELD_LABELS_COMPACT.work_order}</FormLabel>
                        <FormControl>
                          <Input className="h-8 text-xs" placeholder="—" {...f} value={f.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`nbLines.${index}.procurementMeta.position`}
                    render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[11px]">{PROCUREMENT_FIELD_LABELS_COMPACT.position}</FormLabel>
                        <FormControl>
                          <Input className="h-8 text-xs" placeholder="—" {...f} value={f.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`nbLines.${index}.procurementMeta.article_code`}
                    render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[11px]">{PROCUREMENT_FIELD_LABELS_COMPACT.article_code}</FormLabel>
                        <FormControl>
                          <Input className="h-8 text-xs" placeholder="—" {...f} value={f.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`nbLines.${index}.procurementMeta.color`}
                    render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[11px]">{PROCUREMENT_FIELD_LABELS_COMPACT.color}</FormLabel>
                        <FormControl>
                          <Input className="h-8 text-xs" placeholder="—" {...f} value={f.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name={`nbLines.${index}.procurementMeta.length_mm`}
                    render={({ field: f }) => (
                      <FormItem className="space-y-1">
                        <FormLabel className="text-[11px]">{PROCUREMENT_FIELD_LABELS_COMPACT.length_mm}</FormLabel>
                        <FormControl>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            step="any"
                            min={0}
                            placeholder="—"
                            value={f.value === undefined || f.value === null ? "" : f.value}
                            onChange={(e) => {
                              const v = e.target.value;
                              f.onChange(v === "" ? null : Number(v.replace(",", ".")));
                            }}
                            onBlur={f.onBlur}
                            name={f.name}
                            ref={f.ref}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto gap-1"
          onClick={() => append(defaultLine)}
        >
          <Plus className="w-4 h-4" />
          Dodaj stavku
        </Button>
      </div>
    </div>
  );
}
